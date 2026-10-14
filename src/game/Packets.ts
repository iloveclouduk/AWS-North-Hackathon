import Phaser from 'phaser';
import { isFootprint, type Tile } from '@/world/layout';
import { entityDepth, toScreen, type Iso } from './iso';
import { findPath, RouteCache } from './pathfinding';
import type { Pt } from './RoadGraph';
import { rand } from './rng';

/** Real messages hop a tile every 70 ms; the ambient trickle ambles at half that. */
const HOP_MS = 70;
const AMBIENT_HOP_MS = 150;
const FADE_MS = 250;
/** Most packets in flight (plan B6 budget): the tab, and the side panel. */
export const PACKET_CAP = { tab: 24, panel: 16 } as const;
/**
 * How far from either end a packet may cross open ground (never a building). A work spot stands in front of its
 * landmark, up to six tiles in from the sidewalk ring the packets travel; without this no path ever reached one, and
 * the baseline trickle never sent a packet (tests/flow-trickle.test.ts).
 */
const APPROACH = 6;

interface Packet {
  head: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Image;
  /** Screen points of the route. */
  pts: { x: number; y: number }[];
  /** ms since the start; the head is at pts[t / hop]. */
  t: number;
  hop: number;
  /** Head scale (data links between AZs and Regions travel big and slow, to be seen). */
  size: number;
  ambient: boolean;
  /** ms into the end burst, or -1 while travelling. */
  fade: number;
  live: boolean;
}

/**
 * Glowing data packets that travel the road network when agents talk: the architecture, visible. Pooled and moved in
 * the scene's update (no tweens): `send` is a real message (bright, with a trail and a burst at the end), and
 * `sendRoute(..., { ambient: true })` is the city's baseline hum (dim, small, no trail; see FlowTrickle).
 */
export class Packets {
  private pool: Packet[] = [];
  private cap: number = PACKET_CAP.tab;
  /** The roads and sidewalks never change under a packet, so a route between two tiles is found once. */
  private routes = new RouteCache();

  constructor(
    private scene: Phaser.Scene,
    private iso: Iso,
    private grid: number,
    private travel: (x: number, y: number) => boolean,
  ) {
    if (!scene.textures.exists('packet')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1).fillRect(2, 0, 4, 8).fillRect(0, 2, 8, 4);
      g.generateTexture('packet', 8, 8);
      g.destroy();
    }
  }

  /** A real message from one tile to another, along the roads and sidewalks. */
  send(from: Tile, to: Tile, color: number) {
    const path = this.path(from, to);
    if (!path.length) return;
    this.sendRoute([from, ...path], color);
  }

  /** An ambient packet between two tiles (dim, no trail). */
  sendAmbient(from: Tile, to: Tile, color: number) {
    const path = this.path(from, to);
    if (!path.length) return;
    this.sendRoute([from, ...path], color, { ambient: true });
  }

  /** Along the roads and sidewalks, stepping across the open ground next to either end (a work spot, an agent). */
  private path(from: Tile, to: Tile) {
    const near = (x: number, y: number, t: Tile) => Math.abs(x - t.x) + Math.abs(y - t.y) <= APPROACH;
    return this.routes.get(from, to, () =>
      findPath(from, to, this.grid, this.grid, (x, y) => this.travel(x, y) || ((near(x, y, from) || near(x, y, to)) && !isFootprint(x, y))),
    );
  }

  /** A packet along given grid points (fractional points allowed: the highway, the bridges). */
  sendRoute(points: Pt[], color: number, opts: { ambient?: boolean; hop?: number; size?: number } = {}) {
    if (points.length < 2) return;
    const ambient = !!opts.ambient;
    const p = this.take(ambient);
    if (!p) return;
    p.pts = points.map((t) => toScreen(this.iso, t.x, t.y));
    p.t = 0;
    p.hop = opts.hop ?? (ambient ? AMBIENT_HOP_MS : HOP_MS);
    p.size = ambient ? 0.6 : (opts.size ?? 1);
    p.ambient = ambient;
    p.fade = -1;
    p.live = true;
    const s = p.pts[0];
    p.head
      .setPosition(s.x, s.y - 6)
      .setTint(color)
      .setAlpha(ambient ? 0.35 : 1)
      .setScale(p.size)
      .setVisible(true)
      .setDepth(entityDepth(s.y) + 2);
    p.trail.setPosition(s.x, s.y - 6).setTint(color).setAlpha(0.4).setScale(1.8 * p.size).setVisible(!ambient).setDepth(entityDepth(s.y) + 1);
  }

  /** Most packets in flight at once (Ambient sets it per surface). */
  setCap(n: number) {
    this.cap = n;
    const live = this.live();
    for (const p of live.slice(0, Math.max(0, live.length - n))) this.release(p);
  }

  get count() {
    return this.pool.filter((p) => p.live).length;
  }

  get ambientCount() {
    return this.pool.filter((p) => p.live && p.ambient).length;
  }

  /** Per frame from Ambient.update. */
  update(dt: number) {
    for (const p of this.pool) {
      if (!p.live) continue;
      if (p.fade >= 0) {
        p.fade += dt;
        const f = Math.min(1, p.fade / FADE_MS);
        const a0 = p.ambient ? 0.35 : 1;
        p.head.setAlpha(a0 * (1 - f)).setScale(p.ambient ? 0.6 : p.size * (1 + 2 * f));
        p.trail.setAlpha(0.4 * (1 - f)).setScale(p.size * (1.8 + 1.2 * f));
        if (f >= 1) this.release(p);
        continue;
      }
      p.t += dt;
      const at = p.t / p.hop;
      const i = Math.floor(at);
      if (i >= p.pts.length - 1) {
        const end = p.pts[p.pts.length - 1];
        p.head.setPosition(end.x, end.y - 6);
        p.fade = 0;
        continue;
      }
      const a = p.pts[i];
      const b = p.pts[i + 1];
      const f = at - i;
      const x = a.x + (b.x - a.x) * f;
      const y = a.y + (b.y - a.y) * f;
      p.head.setPosition(x, y - 6).setDepth(entityDepth(y) + 2);
      if (!p.ambient) {
        // The trail eases after the head (it used to tween each hop over 110 ms against the head's 70).
        const k = 1 - Math.exp(-dt / 45);
        p.trail.setPosition(p.trail.x + (x - p.trail.x) * k, p.trail.y + (y - 6 - p.trail.y) * k).setDepth(p.head.depth - 1);
      }
    }
  }

  /** Everything off (a Region change). */
  clear() {
    for (const p of this.pool) if (p.live) this.release(p);
  }

  destroy() {
    for (const p of this.pool) p.head.destroy(), p.trail.destroy();
    this.pool = [];
  }

  private live() {
    return this.pool.filter((p) => p.live).sort((a, b) => Number(b.ambient) - Number(a.ambient) || b.t - a.t);
  }

  /** A free packet: from the pool, a new one under the cap, or the oldest ambient one (a real message may take any). */
  private take(ambient: boolean): Packet | undefined {
    const free = this.pool.find((p) => !p.live);
    if (free) return free;
    if (this.pool.length < this.cap) {
      const head = this.scene.add.image(0, 0, 'packet').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      const trail = this.scene.add.image(0, 0, 'packet').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      const p: Packet = { head, trail, pts: [], t: 0, hop: HOP_MS, size: 1, ambient, fade: -1, live: false };
      this.pool.push(p);
      return p;
    }
    const victim = this.live().find((p) => p.ambient) ?? (ambient ? undefined : this.live()[0]);
    if (!victim) return undefined;
    this.release(victim);
    return victim;
  }

  private release(p: Packet) {
    p.live = false;
    p.head.setVisible(false);
    p.trail.setVisible(false);
  }
}

export interface Flow {
  serviceIds: string[];
}

/**
 * The city's baseline hum: every 7–10 s a flow from shared/flows.json with at least two services discovered and offered
 * in this Region sends dim packets between their work spots, one hop after another. Never while a task of the player's
 * runs (real work is what moves then), and never mistaken for it: dim, small, no trail.
 */
export class FlowTrickle {
  private wait = 3000;
  private queue: { at: number; from: Tile; to: Tile; color: number }[] = [];
  private clock = 0;

  constructor(
    private packets: Packets,
    private opts: {
      flows: () => Flow[];
      /** Discovered and offered here, with a work spot. */
      spot: (serviceId: string) => Tile | undefined;
      busy: () => boolean;
      color: (serviceId: string) => number;
    },
  ) {}

  update(dt: number) {
    this.clock += dt;
    if (this.opts.busy()) {
      this.queue = [];
      return;
    }
    while (this.queue.length && this.queue[0].at <= this.clock) {
      const q = this.queue.shift()!;
      this.packets.sendAmbient(q.from, q.to, q.color);
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = 7000 + rand() * 3000;
    const ready = this.opts.flows()
      .map((f) => f.serviceIds.map((id) => ({ id, spot: this.opts.spot(id) })).filter((s): s is { id: string; spot: Tile } => !!s.spot))
      .filter((s) => s.length >= 2);
    if (!ready.length) return;
    const hops = ready[Math.floor(rand() * ready.length)];
    hops.slice(1).forEach((s, i) => this.queue.push({ at: this.clock + i * 1200, from: hops[i].spot, to: s.spot, color: this.opts.color(hops[i].id) }));
  }

  /** Pending hops dropped (a Region change, reduced motion). */
  reset() {
    this.queue = [];
  }
}
