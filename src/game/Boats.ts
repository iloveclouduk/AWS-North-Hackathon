// Boats (plan B3): a sailing boat and a barge on the river that rings downtown (under every bridge), and a ferry on a
// sea lane when the coast has open water. Moved in the scene's update, no tweens; drawn under the bridge decks they
// pass beneath. Under reduced motion they lie at anchor.
import Phaser from 'phaser';
import { RIVER, type Terrain } from '@/world/terrain';
import { addSprite, hasSprite } from './assets';
import { CITY_ISO, dirFor, entityDepth, toScreen } from './iso';
import { measure, pointAt, type Pt } from './RoadGraph';
import { riverLoop, seaLane } from './waterways';
import { rand } from './rng';

/** Boats on the water at once (plan B6 budget). */
export const BOAT_CAP = { tab: 3, panel: 2 } as const;

interface Boat {
  img: Phaser.GameObjects.Image;
  skin: string;
  /** Footprint (tiles): the sprite's N corner sits half of it up and left of the boat's centre. */
  fp: number;
  pts: Pt[];
  cum: number[];
  len: number;
  s: number;
  /** +1 / -1 along the path. */
  way: number;
  loop: boolean;
  speed: number;
  phase: number;
}

export class Boats {
  private boats: Boat[] = [];
  private bridges: Pt[] = [];
  private still = false;

  constructor(private scene: Phaser.Scene) {}

  get count() {
    return this.boats.length;
  }

  /** Launch the boats for a landscape (a Region change rebuilds them). */
  build(t: Terrain, cap: number, still: boolean) {
    this.clear();
    this.still = still;
    this.bridges = t.bridges.flatMap((b) => b.tiles);
    const mid = (RIVER.from + RIVER.to) / 2;
    const wanted: Omit<Boat, 'img' | 'cum' | 'len' | 's' | 'phase'>[] = [];
    const sea = seaLane(t);
    if (sea && hasSprite('veh:ferry:SE')) wanted.push({ skin: 'veh:ferry', fp: 2, pts: sea, way: 1, loop: false, speed: 0.55 });
    if (hasSprite('veh:sail:SE')) wanted.push({ skin: 'veh:sail', fp: 1, pts: riverLoop(mid - 0.4), way: 1, loop: true, speed: 0.7 });
    if (hasSprite('veh:barge:SE')) wanted.push({ skin: 'veh:barge', fp: 2, pts: riverLoop(mid + 0.4), way: -1, loop: true, speed: 0.4 });
    for (const w of wanted.slice(0, cap)) {
      const m = measure(w.pts);
      const img = addSprite(this.scene, `${w.skin}:SE`, 0, 0);
      this.boats.push({ ...w, img, ...m, s: rand() * m.len, phase: rand() * Math.PI * 2 });
    }
    for (const b of this.boats) this.draw(b, 0, true);
  }

  /** Reduced motion: at anchor. */
  setStill(on: boolean) {
    this.still = on;
  }

  update(dt: number, time: number, view: Phaser.Geom.Rectangle) {
    for (const b of this.boats) {
      if (!this.still) {
        b.s += b.way * b.speed * (dt / 1000);
        if (b.loop) b.s = ((b.s % b.len) + b.len) % b.len;
        else if (b.s >= b.len || b.s <= 0) (b.s = Math.max(0, Math.min(b.len, b.s))), (b.way = -b.way);
      }
      const p = pointAt(b.pts, b.cum, b.s);
      const c = toScreen(CITY_ISO, p.x, p.y);
      const on = view.contains(c.x, c.y);
      b.img.setVisible(on);
      if (on) this.draw(b, time);
    }
  }

  clear() {
    for (const b of this.boats) b.img.destroy();
    this.boats = [];
  }

  destroy() {
    this.clear();
  }

  private draw(b: Boat, time: number, force = false) {
    const p = pointAt(b.pts, b.cum, b.s);
    const dir = dirFor(p.dx * b.way, p.dy * b.way);
    const frame = `${b.skin}:${dir}`;
    if (force || b.img.frame.name !== frame) b.img.setFrame(frame);
    const n = toScreen(CITY_ISO, p.x - b.fp / 2, p.y - b.fp / 2);
    // A one-pixel bob on the swell (not under reduced motion).
    const bob = this.still ? 0 : Math.round(Math.sin(time / 700 + b.phase) * 0.6);
    b.img.setPosition(Math.round(n.x), Math.round(n.y) + bob);
    const c = toScreen(CITY_ISO, p.x, p.y);
    let depth = entityDepth(c.y) - 1;
    // Under a bridge: below its deck (the deck's depth is its tile's), so the boat passes beneath.
    const reach = b.fp === 1 ? 1 : 1.3;
    for (const t of this.bridges) {
      if (Math.abs(t.x - p.x) <= reach && Math.abs(t.y - p.y) <= reach) depth = Math.min(depth, entityDepth(toScreen(CITY_ISO, t.x, t.y).y) - 1);
    }
    b.img.setDepth(depth);
  }
}
