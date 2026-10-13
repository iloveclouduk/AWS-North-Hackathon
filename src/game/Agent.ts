import Phaser from 'phaser';
import type { Rect, Tile } from '@/world/layout';
import { FRAME_H, FRAME_W, frameOf, hasAnim, PIVOT, type Dir } from './assets';
import { dirFor, entityDepth, toScreen, type Iso } from './iso';
import { findPath, type RouteCache } from './pathfinding';
import { crisp, SpeechBubble, TEXT_FONT, type SayOptions } from './SpeechBubble';
import { mayShowBubble } from './calm';
import { useCity } from '@/state/store';
import { CSS, labelStyle } from './theme';

/** What a walker needs to know about the world it walks in. */
export interface AgentWorld {
  iso: Iso;
  gridW: number;
  gridH: number;
  walkable(x: number, y: number): boolean;
  /** Optional: restrict wandering to these tiles (e.g. sidewalks for citizens). */
  wanderable?(x: number, y: number): boolean;
  /** Optional: routes shared by every agent in the scene, dropped when the walkable grid changes (plan B6). */
  routes?: RouteCache;
  /** Optional: pick the next idle stroll from where the agent stands (citizens: a sidewalk a short walk away). */
  pickWander?(from: Tile): Tile | undefined;
}

export interface AgentConfig {
  id: string;
  /** Character sheet id (defaults to id). */
  sheet?: string;
  name: string;
  tile: Tile;
  /** Area it wanders in while idle. */
  home: Rect;
  /** Where it stands to do its job. */
  workSpot?: Tile;
  /** Direction to face while working. */
  workDir?: Dir;
  /** Tiles per second. */
  speed?: number;
  /** Idle agents wander; the player doesn't. */
  wanders?: boolean;
  /** Character-sheet animation used while working (activity, or 'type' at a desk). */
  workAnim?: string;
  showTag?: boolean;
  /** The name tag's text while not hovered (e.g. "Rosa"); hovering shows the full `name` ("Rosa · Sustainability"). */
  tagName?: string;
}

type Mode = 'idle' | 'walking' | 'working' | 'emote';

/** Every live agent, per scene: how many bubbles are up decides whether an ambient line may speak. */
const live = new WeakMap<Phaser.Scene, Set<Agent>>();

/**
 * A Habbo-style character: walks tile to tile in 4 directions, idles, emotes and works.
 * The backend drives `setWorking`; tasks drive `goTo` / `pin`.
 */
export class Agent {
  readonly id: string;
  readonly name: string;
  readonly sprite: Phaser.GameObjects.Sprite;
  /** One bubble per agent: a new line replaces the last one (never two stacked over the same head). */
  private bubble: SpeechBubble;
  /** When this agent last spoke (scene time): a newer bubble steps aside for an older one nearby. */
  private spokeAt = 0;
  private shadow: Phaser.GameObjects.Ellipse;
  private tag: Phaser.GameObjects.Text;
  private busy: Phaser.GameObjects.Rectangle;
  private scene: Phaser.Scene;
  private world: AgentWorld;
  private sheet: string;
  private cfg: AgentConfig;

  gx: number;
  gy: number;
  dir: Dir = 'SE';
  private path: Tile[] = [];
  private mode: Mode = 'idle';
  private wantsWork = false;
  private pinned = false;
  private wanderAt = 0;
  private onArrive?: () => void;
  private uiScale = 1;
  /** Frame height relative to a full 48×72 character (crowd sheets: 0.75). */
  private k = 1;
  private hovered = false;
  private detail?: string;
  private currentAnim = '';
  /** Destroyed: timers still pending (an emote's end) must leave it alone. */
  private dead = false;
  speedBoost = 1;
  onStep?: (t: Tile) => void;

  constructor(scene: Phaser.Scene, world: AgentWorld, cfg: AgentConfig) {
    this.scene = scene;
    this.world = world;
    this.cfg = cfg;
    this.id = cfg.id;
    this.name = cfg.name;
    this.sheet = cfg.sheet ?? cfg.id;
    this.gx = cfg.tile.x;
    this.gy = cfg.tile.y;

    // Crowd sheets are 3/4 size: the shadow and the head height (bubble, busy dot) follow the frame.
    this.k = frameOf(this.sheet)[1] / FRAME_H;
    this.shadow = scene.add.ellipse(0, 0, Math.round(20 * this.k), Math.max(5, Math.round(7 * this.k)), 0x000000, 0.28);
    this.sprite = scene.add.sprite(0, 0, `char:${this.sheet}`, 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H);
    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 1 });
    this.busy = scene.add.rectangle(0, 0, 5, 5, 0x22c55e).setStrokeStyle(1, 0x14532d).setVisible(false);
    this.tag = crisp(
      scene.add
        .text(0, 0, cfg.tagName ?? cfg.name, labelStyle(TEXT_FONT, CSS.inkHi))
        .setOrigin(0.5, 0)
        .setVisible(!!cfg.showTag),
    );
    this.bubble = new SpeechBubble(scene);
    if (!live.has(scene)) live.set(scene, new Set());
    live.get(scene)!.add(this);

    this.sprite.on('pointerover', () => {
      this.hovered = true;
      this.syncTag();
    });
    this.sprite.on('pointerout', () => {
      this.hovered = false;
      this.syncTag();
    });
    this.play('idle');
    this.wanderAt = scene.time.now + 1000 + Math.random() * 4000;
    this.sync();
  }

  /** Swap the character sheet (e.g. Kai's earned golden jacket). */
  setSheet(sheet: string) {
    if (sheet === this.sheet) return;
    this.sheet = sheet;
    this.currentAnim = '';
    this.play(this.mode === 'walking' ? 'walk' : 'idle');
  }

  /** Change where the agent wanders when idle. */
  setHome(home: Rect) {
    this.cfg = { ...this.cfg, home };
  }

  get tile(): Tile {
    return { x: Math.round(this.gx), y: Math.round(this.gy) };
  }
  get isWorking() {
    return this.mode === 'working';
  }
  get isBusy() {
    return this.mode !== 'idle' || this.pinned;
  }
  get screen() {
    return toScreen(this.world.iso, this.gx, this.gy);
  }

  /** Play `<sheet>:<anim>:<dir>`, falling back to idle when this character lacks the animation. */
  play(anim: string, dir: Dir = this.dir) {
    if (this.dead) return; // a timer from before destroy() (an emote ending) finds nothing to animate
    const name = hasAnim(this.sheet, anim) ? anim : 'idle';
    const key = `${this.sheet}:${name}:${dir}`;
    if (key === this.currentAnim) return;
    this.currentAnim = key;
    this.dir = dir;
    this.sprite.play(key);
  }

  /** Called on every line spoken (the scene plays a chat blip). */
  onSpeak?: (agent: Agent) => void;

  /** Short speaker name for bubbles: "Sally the Angler" → "Sally". */
  get shortName() {
    return this.name.split(' the ')[0].replace(' (you)', '');
  }

  /** True while this agent's bubble is up. */
  get speaking() {
    return this.bubble.showing;
  }

  /** Bubbles up now in this agent's scene, not counting the player's. */
  private visibleBubbles() {
    let n = 0;
    for (const a of live.get(this.scene) ?? []) if (a.id !== 'player' && a.speaking) n++;
    return n;
  }

  /**
   * A new line replaces this agent's last one in place; a bubble near another agent's steps up above it (sync).
   * An ambient line stays quiet unless chatter is on and nobody else is talking; returns whether it showed.
   */
  say(text: string, opts?: SayOptions): boolean {
    if (!mayShowBubble(opts?.priority ?? 'normal', this.visibleBubbles(), useCity.getState().prefs.chatter)) return false;
    this.bubble.say(text, this.shortName, opts);
    this.spokeAt = this.scene.time.now;
    if (!opts?.silent) this.onSpeak?.(this);
    this.sync();
    return true;
  }

  /** Walk to a tile; `onArrive` fires when there (or immediately if unreachable). */
  goTo(target: Tile, onArrive?: () => void) {
    const from = this.tile;
    const find = () => findPath(from, target, this.world.gridW, this.world.gridH, (x, y) => this.world.walkable(x, y));
    const path = this.world.routes ? this.world.routes.get(from, target, find) : find();
    this.onArrive = onArrive;
    if (!path.length) {
      this.path = [];
      this.arrive();
      return;
    }
    this.path = path;
    this.mode = 'walking';
  }

  /** One step in a direction (keyboard control). Returns false if blocked. */
  step(dx: number, dy: number) {
    if (this.mode === 'walking' && this.path.length > 1) return true;
    const t = this.tile;
    const n = { x: t.x + dx, y: t.y + dy };
    if (!this.world.walkable(n.x, n.y)) {
      this.play('idle', dirFor(dx, dy));
      return false;
    }
    this.path = [n];
    this.mode = 'walking';
    return true;
  }

  goToWork(onArrive?: () => void) {
    if (!this.cfg.workSpot) return onArrive?.();
    this.goTo(this.cfg.workSpot, onArrive);
  }

  pin(on: boolean) {
    this.pinned = on;
    if (!on) this.wanderAt = this.scene.time.now + 2500;
  }

  /** Backend says a real AWS call is running (or finished) for this agent. */
  setWorking(on: boolean) {
    this.wantsWork = on;
    if (on) {
      if (this.atWorkSpot()) this.startWork();
      else if (this.mode !== 'walking' || !this.pinned) this.goToWork();
    } else if (this.mode === 'working') {
      this.stopWork();
    }
  }

  setDetail(detail?: string) {
    this.detail = detail;
    this.syncTag();
  }

  /** Whether the name tag shows at rest (the scene's label budget). Hover and work always show it. */
  setTagShown(on: boolean) {
    if (this.cfg.showTag === on) return;
    this.cfg = { ...this.cfg, showTag: on };
    this.syncTag();
  }

  /** The tag: short name at rest, full name (and role) on hover; what it's doing while it works. */
  private syncTag() {
    const base = this.hovered ? this.name : (this.cfg.tagName ?? this.name);
    this.tag.setText(this.detail ? `${base} · ${this.detail}` : base);
    this.tag.setVisible(!!this.cfg.showTag || this.hovered || this.mode === 'working');
  }

  setUiScale(s: number) {
    if (s === this.uiScale) return;
    this.uiScale = s;
    this.bubble.setScale(s);
    this.tag.setScale(s);
  }

  /** Short one-off animation (wave, hi, laugh, jump…), then back to idle. */
  emote(anim: string, ms = 1400, dir?: Dir) {
    if (this.mode === 'walking' || this.mode === 'working') return;
    this.mode = 'emote';
    this.play(anim, dir ?? this.dir);
    this.scene.time.delayedCall(ms, () => {
      if (this.mode !== 'emote') return;
      this.mode = 'idle';
      this.play('idle');
    });
  }

  /** Loop an animation until something else happens (sit on a bench, fish at the lake…). */
  hold(anim: string, dir: Dir) {
    this.mode = 'emote';
    this.path = [];
    this.play(anim, dir);
  }

  release() {
    if (this.mode === 'emote') {
      this.mode = 'idle';
      this.play('idle');
    }
  }

  face(target: Tile) {
    this.dir = dirFor(target.x - this.gx, target.y - this.gy);
    this.play(this.mode === 'working' ? this.workAnim() : 'idle', this.dir);
  }

  teleport(t: Tile) {
    this.gx = t.x;
    this.gy = t.y;
    this.path = [];
    this.sync();
  }

  onClick(fn: () => void) {
    this.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.getDistance() < 8) fn();
    });
  }

  destroy() {
    this.dead = true;
    live.get(this.scene)?.delete(this);
    for (const o of [this.sprite, this.shadow, this.tag, this.busy, this.bubble]) o.destroy();
  }

  update(time: number, dtMs: number) {
    if (this.mode === 'walking') this.walk(dtMs);
    else if (this.mode === 'idle' && !this.pinned && this.cfg.wanders !== false && time > this.wanderAt) this.wander();
    this.sync();
  }

  private workAnim() {
    return this.cfg.workAnim ?? 'talk';
  }

  private atWorkSpot() {
    const w = this.cfg.workSpot;
    return !!w && this.tile.x === w.x && this.tile.y === w.y && this.mode !== 'walking';
  }

  private startWork() {
    this.mode = 'working';
    this.path = [];
    this.play(this.workAnim(), this.cfg.workDir ?? 'SE');
    this.busy.setVisible(true);
    this.syncTag();
  }

  private stopWork() {
    this.mode = 'idle';
    this.play('idle');
    this.busy.setVisible(false);
    this.syncTag();
    this.wanderAt = this.scene.time.now + 3000 + Math.random() * 3000;
  }

  private wander() {
    const picked = this.world.pickWander?.({ x: Math.round(this.gx), y: Math.round(this.gy) });
    if (picked) {
      this.goTo(picked);
      this.wanderAt = this.scene.time.now + 2500 + Math.random() * 6000;
      return;
    }
    const h = this.cfg.home;
    const ok = this.world.wanderable ?? this.world.walkable;
    for (let i = 0; i < 10; i++) {
      const t = { x: h.x + Math.floor(Math.random() * h.w), y: h.y + Math.floor(Math.random() * h.h) };
      if (ok(t.x, t.y) && this.world.walkable(t.x, t.y) && Math.abs(t.x - this.gx) + Math.abs(t.y - this.gy) <= 6) {
        this.goTo(t);
        break;
      }
    }
    this.wanderAt = this.scene.time.now + 2500 + Math.random() * 6000;
  }

  private walk(dtMs: number) {
    const next = this.path[0];
    if (!next) return this.arrive();
    const speed = (this.cfg.speed ?? 2) * this.speedBoost * (dtMs / 1000);
    const dx = next.x - this.gx;
    const dy = next.y - this.gy;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) this.play('walk', dirFor(dx, dy));
    if (dist <= speed) {
      this.gx = next.x;
      this.gy = next.y;
      this.path.shift();
      this.onStep?.(next);
      if (!this.path.length) this.arrive();
    } else {
      this.gx += (dx / dist) * speed;
      this.gy += (dy / dist) * speed;
    }
  }

  private arrive() {
    this.mode = 'idle';
    this.play('idle');
    const cb = this.onArrive;
    this.onArrive = undefined;
    if (this.wantsWork && this.atWorkSpot()) this.startWork();
    cb?.();
  }

  private sync() {
    const { x, y } = this.screen;
    const d = entityDepth(y);
    this.shadow.setPosition(x, y).setDepth(d - 1);
    this.sprite.setPosition(Math.round(x), Math.round(y)).setDepth(d);
    const top = y - Math.round(58 * this.k);
    this.busy.setPosition(x + Math.round(10 * this.k), top + 6).setDepth(d + 1);
    this.tag.setPosition(x, y + 3).setDepth(50_000);
    const b = this.bubble;
    if (!b.visible) return;
    // Keep the bubble inside the camera view, so a line spoken at the edge of the city stays readable.
    const view = this.scene.cameras.main.worldView;
    const k = this.uiScale;
    const pad = 4 * k;
    const half = (b.boxW / 2) * k;
    const h = b.boxH * k;
    const bx = !view.width || 2 * (half + pad) >= view.width ? x : Math.min(Math.max(x, view.x + half + pad), view.right - half - pad);
    let by = view.height ? Math.min(Math.max(top, view.y + h + pad), view.bottom - pad) : top;
    // Another agent's bubble here already (an older one): step up above it rather than cover it.
    for (const a of live.get(this.scene) ?? []) {
      const o = a.bubble;
      if (a === this || !o.showing || a.spokeAt > this.spokeAt || (a.spokeAt === this.spokeAt && a.id > this.id)) continue;
      const oh = o.boxH * k;
      const ohalf = (o.boxW / 2) * k;
      if (Math.abs(o.x - bx) < half + ohalf + pad && by > o.y - oh - pad && by - h < o.y + pad) by = o.y - oh - pad;
    }
    b.setPosition(bx, by).setDepth(60_000 + (this.spokeAt % 1000) / 1000);
  }
}
