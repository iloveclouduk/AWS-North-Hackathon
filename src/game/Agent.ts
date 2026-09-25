import Phaser from 'phaser';
import type { Rect, Tile } from '@/world/layout';
import { entityDepth, toScreen, type Iso } from './iso';
import { findPath } from './pathfinding';
import { SpeechBubble, UI_FONT, type SayOptions } from './SpeechBubble';
import { FEET_Y, FH, PX, registerAgentSheet, type Look } from './sprites';

/** What an agent needs to know about the world it walks in. */
export interface AgentWorld {
  iso: Iso;
  gridW: number;
  gridH: number;
  walkable(x: number, y: number): boolean;
}

export interface AgentConfig {
  id: string;
  name: string;
  look: Look;
  tile: Tile;
  /** Area it wanders in while idle. */
  home: Rect;
  /** Where it stands to do its job. */
  workSpot?: Tile;
  /** Tiles per second. */
  speed?: number;
  /** Idle agents wander; the player avatar doesn't. */
  wanders?: boolean;
  /** Animation used while working: its own activity, or sat typing (interiors). */
  workAnim?: 'work' | 'type';
  scale?: number;
}

type Mode = 'idle' | 'walking' | 'working';

/**
 * An NPC. Idle = wander around home. Working = go to the work spot and play the activity animation.
 * The backend drives `setWorking`; tasks drive `goTo`/`pin`.
 */
export class Agent {
  readonly id: string;
  readonly name: string;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly bubble: SpeechBubble;
  private shadow: Phaser.GameObjects.Ellipse;
  private tag: Phaser.GameObjects.Text;
  private busy: Phaser.GameObjects.Arc;
  private scene: Phaser.Scene;
  private world: AgentWorld;
  private key: string;
  private cfg: AgentConfig;

  /** Continuous grid position. */
  gx: number;
  gy: number;
  private path: Tile[] = [];
  private mode: Mode = 'idle';
  private wantsWork = false;
  private pinned = false; // on a task: stay at the work spot, don't wander
  private wanderAt = 0;
  private onArrive?: () => void;
  private facingBack = false;
  private uiScale = 1;

  constructor(scene: Phaser.Scene, world: AgentWorld, cfg: AgentConfig) {
    this.scene = scene;
    this.world = world;
    this.cfg = cfg;
    this.id = cfg.id;
    this.name = cfg.name;
    this.gx = cfg.tile.x;
    this.gy = cfg.tile.y;
    this.key = cfg.id;
    registerAgentSheet(scene, this.key, cfg.look);

    const scale = cfg.scale ?? 1;
    this.shadow = scene.add.ellipse(0, 0, 34 * scale, 12 * scale, 0x000000, 0.22);
    this.sprite = scene.add.sprite(0, 0, `agent:${this.key}`, 0).setOrigin(0.5, FEET_Y / FH).setScale(scale);
    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });
    this.busy = scene.add.circle(0, 0, 4, 0x22c55e).setStrokeStyle(2, 0x14532d).setVisible(false);
    this.tag = scene.add
      .text(0, 0, cfg.name, { fontFamily: UI_FONT, fontSize: '11px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#161622cc', padding: { x: 4, y: 2 }, resolution: 2 })
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.bubble = new SpeechBubble(scene);

    this.sprite.on('pointerover', () => this.tag.setVisible(true));
    this.sprite.on('pointerout', () => this.tag.setVisible(this.mode === 'working'));
    this.sprite.play(`${this.key}:idle`);
    this.wanderAt = scene.time.now + 1000 + Math.random() * 4000;
    this.sync();
  }

  get tile(): Tile {
    return { x: Math.round(this.gx), y: Math.round(this.gy) };
  }
  get isWorking() {
    return this.mode === 'working';
  }
  get screen() {
    return toScreen(this.world.iso, this.gx, this.gy);
  }

  say(text: string, opts?: SayOptions) {
    this.bubble.say(text, opts);
  }

  /** Walk to a tile; resolves when arrived (or immediately if unreachable). */
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

  goToWork(onArrive?: () => void) {
    if (!this.cfg.workSpot) return onArrive?.();
    this.goTo(this.cfg.workSpot, onArrive);
  }

  /** Keep the agent at its post (during a task) instead of wandering. */
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

  /** Keep bubbles/tags readable when the camera is zoomed out. */
  setUiScale(s: number) {
    if (s === this.uiScale) return;
    this.uiScale = s;
    this.bubble.setScale(s);
    this.tag.setScale(s);
  }

  /** Name tag shows what the agent is doing, e.g. "Sally · PutObject photos/1.jpg". */
  setDetail(detail?: string) {
    this.tag.setText(detail ? `${this.name} · ${detail}` : this.name);
  }

  /** Little "I see you" moment when the user opens this agent's page. */
  wave() {
    if (this.mode !== 'idle') return;
    this.sprite.play(`${this.key}:wave`);
    this.scene.time.delayedCall(1200, () => this.mode === 'idle' && this.sprite.play(`${this.key}:idle`));
  }

  teleport(t: Tile) {
    this.gx = t.x;
    this.gy = t.y;
    this.path = [];
    this.sync();
  }

  onClick(fn: () => void) {
    // Scenes ignore ground clicks when something is under the pointer, so no propagation dance needed.
    this.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.getDistance() < 8) fn();
    });
  }

  destroy() {
    for (const o of [this.sprite, this.shadow, this.tag, this.busy, this.bubble]) o.destroy();
  }

  update(time: number, dtMs: number) {
    if (this.mode === 'walking') this.step(dtMs);
    else if (this.mode === 'idle' && !this.pinned && this.cfg.wanders !== false && time > this.wanderAt) this.wander();
    this.sync();
  }

  private atWorkSpot() {
    const w = this.cfg.workSpot;
    return !!w && this.tile.x === w.x && this.tile.y === w.y && this.mode !== 'walking';
  }

  private startWork() {
    this.mode = 'working';
    this.path = [];
    this.sprite.setFlipX(false);
    this.sprite.play(`${this.key}:${this.cfg.workAnim ?? 'work'}`);
    this.busy.setVisible(true);
    this.tag.setVisible(true);
  }

  private stopWork() {
    this.mode = 'idle';
    this.sprite.play(`${this.key}:idle`);
    this.busy.setVisible(false);
    this.tag.setVisible(false);
    this.wanderAt = this.scene.time.now + 3000 + Math.random() * 3000;
  }

  private wander() {
    const h = this.cfg.home;
    for (let i = 0; i < 8; i++) {
      const t = { x: h.x + Math.floor(Math.random() * h.w), y: h.y + Math.floor(Math.random() * h.h) };
      if (this.world.walkable(t.x, t.y) && Math.abs(t.x - this.gx) + Math.abs(t.y - this.gy) <= 5) {
        this.goTo(t);
        break;
      }
    }
    this.wanderAt = this.scene.time.now + 2500 + Math.random() * 5000;
  }

  private step(dtMs: number) {
    const next = this.path[0];
    if (!next) return this.arrive();
    const speed = (this.cfg.speed ?? 2.2) * (dtMs / 1000);
    const dx = next.x - this.gx;
    const dy = next.y - this.gy;
    const dist = Math.hypot(dx, dy);
    // screen-space direction picks the animation: up the screen = back view, left = flipped
    const sdx = dx - dy;
    const sdy = dx + dy;
    const back = sdy < -0.01;
    const anim = back ? 'backWalk' : 'walk';
    if (this.sprite.anims.currentAnim?.key !== `${this.key}:${anim}`) this.sprite.play(`${this.key}:${anim}`);
    this.facingBack = back;
    if (Math.abs(sdx) > 0.01) this.sprite.setFlipX(sdx < 0);
    if (dist <= speed) {
      this.gx = next.x;
      this.gy = next.y;
      this.path.shift();
      if (!this.path.length) this.arrive();
    } else {
      this.gx += (dx / dist) * speed;
      this.gy += (dy / dist) * speed;
    }
  }

  private arrive() {
    this.mode = 'idle';
    this.sprite.play(`${this.key}:${this.facingBack ? 'backIdle' : 'idle'}`);
    const cb = this.onArrive;
    this.onArrive = undefined;
    if (this.wantsWork && this.atWorkSpot()) this.startWork();
    cb?.();
  }

  private sync() {
    const { x, y } = this.screen;
    const d = entityDepth(y);
    const s = this.cfg.scale ?? 1;
    this.shadow.setPosition(x, y).setDepth(d - 1);
    this.sprite.setPosition(x, y).setDepth(d);
    const top = y - (FEET_Y - 2) * PX * s;
    this.busy.setPosition(x + 18 * s, top + 6).setDepth(d + 1);
    this.tag.setPosition(x, y + 8).setDepth(50_000);
    this.bubble.setPosition(x, top).setDepth(60_000);
  }
}
