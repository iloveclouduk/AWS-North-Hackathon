import Phaser from 'phaser';
import type { Rect, Tile } from '@/world/layout';
import { FRAME_H, FRAME_W, hasAnim, PIVOT, type Dir } from './assets';
import { dirFor, entityDepth, toScreen, type Iso } from './iso';
import { findPath } from './pathfinding';
import { PIXEL_FONT, SpeechBubble, type SayOptions } from './SpeechBubble';

/** What a walker needs to know about the world it walks in. */
export interface AgentWorld {
  iso: Iso;
  gridW: number;
  gridH: number;
  walkable(x: number, y: number): boolean;
  /** Optional: restrict wandering to these tiles (e.g. sidewalks for citizens). */
  wanderable?(x: number, y: number): boolean;
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
}

type Mode = 'idle' | 'walking' | 'working' | 'emote';

/**
 * A Habbo-style character: walks tile to tile in 4 directions, idles, emotes and works.
 * The backend drives `setWorking`; tasks drive `goTo` / `pin`.
 */
export class Agent {
  readonly id: string;
  readonly name: string;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly bubble: SpeechBubble;
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
  private currentAnim = '';
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

    this.shadow = scene.add.ellipse(0, 0, 22, 8, 0x000000, 0.25);
    this.sprite = scene.add.sprite(0, 0, `char:${this.sheet}`, 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H);
    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 1 });
    this.busy = scene.add.rectangle(0, 0, 5, 5, 0x22c55e).setStrokeStyle(1, 0x14532d).setVisible(false);
    this.tag = scene.add
      .text(0, 0, cfg.name, { fontFamily: PIXEL_FONT, fontSize: '16px', color: '#ffffff', backgroundColor: '#161622cc', padding: { x: 3, y: 0 } })
      .setOrigin(0.5, 0)
      .setVisible(!!cfg.showTag);
    this.bubble = new SpeechBubble(scene);

    this.sprite.on('pointerover', () => this.tag.setVisible(true));
    this.sprite.on('pointerout', () => this.tag.setVisible(!!cfg.showTag || this.mode === 'working'));
    this.play('idle');
    this.wanderAt = scene.time.now + 1000 + Math.random() * 4000;
    this.sync();
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
    const name = hasAnim(this.sheet, anim) ? anim : 'idle';
    const key = `${this.sheet}:${name}:${dir}`;
    if (key === this.currentAnim) return;
    this.currentAnim = key;
    this.dir = dir;
    this.sprite.play(key);
  }

  say(text: string, opts?: SayOptions) {
    this.bubble.say(text, opts);
  }

  /** Walk to a tile; `onArrive` fires when there (or immediately if unreachable). */
  goTo(target: Tile, onArrive?: () => void) {
    const path = findPath(this.tile, target, this.world.gridW, this.world.gridH, (x, y) => this.world.walkable(x, y));
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
    this.tag.setText(detail ? `${this.name} · ${detail}` : this.name);
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
    this.tag.setVisible(true);
  }

  private stopWork() {
    this.mode = 'idle';
    this.play('idle');
    this.busy.setVisible(false);
    this.tag.setVisible(!!this.cfg.showTag);
    this.wanderAt = this.scene.time.now + 3000 + Math.random() * 3000;
  }

  private wander() {
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
    const top = y - 50;
    this.busy.setPosition(x + 10, top).setDepth(d + 1);
    this.tag.setPosition(x, y + 4).setDepth(50_000);
    this.bubble.setPosition(x, top - 4).setDepth(60_000);
  }
}
