// Storms over the city (contract v2.6): the one place the sky means something. They come only from AWS's public
// Health Dashboard, never from the player's account or from ambience. A Region-wide event (Bahrain 2026) greys the
// whole city with rain; a service-level one puts a dark cloud over each affected landmark. Rain is one Graphics
// redrawn each frame from a fixed pool, with no tweens; it stops while the page is hidden and isn't drawn at all under
// reduced motion (the clouds and the grey stay, standing still).
import Phaser from 'phaser';
import type { Surface } from '@/world/traffic';
import { reducedMotion } from './motion';

export const RAIN_CAP: Record<Surface, number> = { tab: 90, panel: 50 };
const CLOUD_DEPTH = 66_100;
const RAIN_DEPTH = 66_150;
/** Under the night overlay (70,000), so night still darkens the storm. */
const GLOOM_DEPTH = 69_900;
const FALL = 140; // px/s
const DROP = 5; // px long
const LOCAL_SPREAD = 34;
const LOCAL_FALL = 56;

export type StormLevel = 'degradation' | 'disruption';
export interface Storm {
  /** The whole city (most of its landmarks are hit). */
  regionWide?: StormLevel;
  /** Over single landmarks: screen point of the roof. */
  spots: { x: number; y: number; level: StormLevel }[];
}

interface Drop {
  x: number;
  y: number;
  /** Where it stops (local rain falls only under its cloud). */
  floor: number;
  spot: number; // -1 = city-wide
}

export class Weather {
  private gloom: Phaser.GameObjects.Rectangle;
  private clouds: Phaser.GameObjects.Graphics;
  private rain: Phaser.GameObjects.Graphics;
  private drops: Drop[] = [];
  private storm: Storm = { spots: [] };
  private cap: number;
  private still = reducedMotion();
  private t = 0;

  constructor(
    private scene: Phaser.Scene,
    surface: Surface,
  ) {
    this.cap = RAIN_CAP[surface];
    this.gloom = scene.add.rectangle(0, 0, 10, 10, 0x55607a, 0).setOrigin(0).setScrollFactor(0).setDepth(GLOOM_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
    this.clouds = scene.add.graphics().setDepth(CLOUD_DEPTH);
    this.rain = scene.add.graphics().setDepth(RAIN_DEPTH);
  }

  get active() {
    return !!this.storm.regionWide || this.storm.spots.length > 0;
  }

  /** How many drops are falling (smoke tests read it). */
  get count() {
    return this.drops.length;
  }

  set(storm: Storm) {
    // The same storm again (an inventory refresh): keep the rain falling.
    if (JSON.stringify(storm) === JSON.stringify(this.storm)) return;
    this.storm = storm;
    this.drops = [];
    this.gloom.setVisible(!!storm.regionWide).setFillStyle(0x55607a, storm.regionWide === 'disruption' ? 0.38 : 0.2);
    this.drawClouds();
    if (!this.active) this.rain.clear();
  }

  setSurface(s: Surface) {
    this.cap = RAIN_CAP[s];
    if (this.drops.length > this.cap) this.drops.length = this.cap;
  }

  setStill(on: boolean) {
    this.still = on;
    if (on) {
      this.drops = [];
      this.rain.clear();
    }
  }

  /** Dark puffs over each affected landmark: three overlapping ellipses, darker for a disruption. */
  private drawClouds() {
    const g = this.clouds.clear();
    for (const s of this.storm.spots) {
      const c = s.level === 'disruption' ? 0x3d4150 : 0x6a6f80;
      g.fillStyle(0x000000, 0.18).fillEllipse(s.x, s.y + LOCAL_FALL + 4, 52, 14);
      g.fillStyle(c, 0.92);
      g.fillEllipse(s.x - 14, s.y + 2, 30, 16).fillEllipse(s.x + 13, s.y + 3, 28, 14).fillEllipse(s.x, s.y - 5, 32, 20);
      g.fillStyle(0xffffff, 0.08).fillEllipse(s.x - 4, s.y - 9, 20, 6);
    }
  }

  private spawn(view: Phaser.Geom.Rectangle): Drop | undefined {
    const spots = this.storm.spots;
    // City-wide rain takes most of the pool; each cloud gets a share.
    const wide = !!this.storm.regionWide && (spots.length === 0 || Math.random() < 0.7);
    if (wide) {
      const x = view.x + Math.random() * view.width;
      return { x, y: view.y + Math.random() * view.height * 0.2, floor: view.y + view.height * (0.6 + Math.random() * 0.45), spot: -1 };
    }
    if (!spots.length) return undefined;
    const i = Math.floor(Math.random() * spots.length);
    const s = spots[i];
    return { x: s.x + (Math.random() - 0.5) * LOCAL_SPREAD * 1.4, y: s.y + 6 + Math.random() * 10, floor: s.y + LOCAL_FALL * (0.8 + Math.random() * 0.4), spot: i };
  }

  update(dt: number) {
    if (!this.active) return;
    const cam = this.scene.cameras.main;
    if (this.storm.regionWide) {
      this.gloom.setSize(cam.width / cam.zoom + 4, cam.height / cam.zoom + 4);
      this.gloom.setPosition(cam.width / 2 - cam.width / cam.zoom / 2 - 2, cam.height / 2 - cam.height / cam.zoom / 2 - 2);
    }
    if (this.still || (typeof document !== 'undefined' && document.hidden)) return;
    this.t += dt;
    const view = cam.worldView;
    const step = (FALL * Math.min(dt, 100)) / 1000;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y += step;
      d.x -= step * 0.18; // a little wind
      if (d.y > d.floor) {
        const next = this.spawn(view);
        if (next) this.drops[i] = next;
        else this.drops.splice(i, 1);
      }
    }
    // Fill the pool gradually so the rain starts rather than appears.
    for (let k = 0; k < 3 && this.drops.length < this.cap; k++) {
      const d = this.spawn(view);
      if (d) this.drops.push(d);
    }
    const g = this.rain.clear();
    g.lineStyle(1, 0xb8c8e8, this.storm.regionWide === 'disruption' ? 0.55 : 0.45);
    for (const d of this.drops) g.lineBetween(Math.round(d.x), Math.round(d.y), Math.round(d.x - 1), Math.round(d.y + DROP));
  }

  destroy() {
    this.gloom.destroy();
    this.clouds.destroy();
    this.rain.destroy();
    this.drops = [];
  }
}
