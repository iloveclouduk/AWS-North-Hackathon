// The sky over the city (plan B3): a few slow clouds with their shadows on the ground (hidden when zoomed in close), a
// flock of birds now and then, and a plane out over the Region gate (more often when the account has data moving
// between Regions). Moved in the scene's update, no tweens; all of it under the night overlay (depth 70,000).
import Phaser from 'phaser';
import { addSprite, hasSprite } from './assets';
import { CITY_ISO, toScreen } from './iso';
import { rand } from './rng';

export const CLOUD_CAP = { tab: 3, panel: 2 } as const;
const CLOUD_DEPTH = 66_000;
const CLOUD_SHADOW_DEPTH = 65_000;
const PLANE_DEPTH = 66_500;
const BIRD_DEPTH = 66_200;
/** Zoomed in this close, the clouds would fill the view: they hide. */
const CLOUD_HIDE_ZOOM = 3;
const WIND = 7; // px/s
const FLOCK = 5;

interface Cloud {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  x: number;
  y: number;
}

interface Flight {
  img: Phaser.GameObjects.Image;
  shadow?: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alt: number;
  climb: number;
  ttl: number;
}

export class Sky {
  private clouds: Cloud[] = [];
  private birds: (Flight & { phase: number })[] = [];
  private plane?: Flight;
  private birdWait = 12_000;
  private planeWait = 20_000;
  private flapAt = 0;
  private flap = 0;
  private still = false;
  /** Where the highway leaves the core (screen), and the way out (unit vector, screen). */
  private gate = { x: 0, y: 0 };
  private out = { x: 0, y: 0 };
  /** The clouds start spread over the first view the camera shows (the camera isn't framed yet at build). */
  private placed = false;
  /** Cross-Region links in the account: planes come more often. */
  busyAir = false;

  constructor(private scene: Phaser.Scene) {}

  build(gate: { x: number; y: number }, cap: number, still: boolean) {
    this.clear();
    this.still = still;
    const g = toScreen(CITY_ISO, gate.x, gate.y);
    const e = toScreen(CITY_ISO, gate.x + 1, gate.y);
    const len = Math.hypot(e.x - g.x, e.y - g.y) || 1;
    this.gate = g;
    this.out = { x: (e.x - g.x) / len, y: (e.y - g.y) / len };
    this.placed = false;
    for (let k = 0; k < cap && hasSprite(`cloud${k}`); k++) {
      const x = 0;
      const y = 0;
      const img = addSprite(this.scene, `cloud${k}`, x, y).setAlpha(0.6).setDepth(CLOUD_DEPTH);
      const shadow = addSprite(this.scene, 'cloudShadow', x, y).setDepth(CLOUD_SHADOW_DEPTH);
      this.clouds.push({ img, shadow, x, y });
    }
  }

  setStill(on: boolean) {
    this.still = on;
    if (on) this.endFlights();
  }

  get counts() {
    return { clouds: this.clouds.length, planes: this.plane ? 1 : 0, flocks: this.birds.length ? 1 : 0 };
  }

  update(dt: number, view: Phaser.Geom.Rectangle, zoom: number) {
    const s = dt / 1000;
    const hide = zoom >= CLOUD_HIDE_ZOOM;
    if (!this.placed) {
      this.placed = true;
      for (const c of this.clouds) (c.x = view.x + rand() * view.width), (c.y = view.y + rand() * view.height * 0.8);
    }
    for (const c of this.clouds) {
      if (!this.still) c.x += WIND * s;
      // Gone past the view (or far from it, after a pan): back in upwind, somewhere new.
      const w = c.img.width;
      const reach = Math.max(view.width, view.height, 400);
      if (c.x - w > view.right + 120 || c.x < view.x - reach || c.y < view.y - reach || c.y > view.bottom + reach) {
        c.x = view.x - w - rand() * 200;
        c.y = view.y + rand() * view.height;
      }
      c.img.setVisible(!hide).setPosition(Math.round(c.x), Math.round(c.y));
      // The sun is high in the south-west: the shadow falls below and a little right.
      c.shadow.setVisible(!hide).setPosition(Math.round(c.x + 30), Math.round(c.y + 110));
    }
    if (this.still) return;
    this.updateBirds(dt, s, view);
    this.updatePlane(dt, s);
  }

  clear() {
    for (const c of this.clouds) c.img.destroy(), c.shadow.destroy();
    this.clouds = [];
    this.endFlights();
  }

  destroy() {
    this.clear();
  }

  private endFlights() {
    for (const b of this.birds) b.img.destroy();
    this.birds = [];
    this.plane?.img.destroy();
    this.plane?.shadow?.destroy();
    this.plane = undefined;
  }

  /** Every 30–60 s a flock crosses the view, flapping. */
  private updateBirds(dt: number, s: number, view: Phaser.Geom.Rectangle) {
    if (!this.birds.length) {
      this.birdWait -= dt;
      if (this.birdWait > 0 || !hasSprite('bird0')) return;
      this.birdWait = 30_000 + rand() * 30_000;
      const ltr = rand() < 0.5;
      const x0 = ltr ? view.x - 40 : view.right + 40;
      const y0 = view.y + view.height * (0.15 + rand() * 0.5);
      const vx = (ltr ? 1 : -1) * (34 + rand() * 10);
      const vy = (rand() - 0.5) * 8;
      for (let i = 0; i < FLOCK; i++) {
        // A loose V.
        const back = Math.ceil(i / 2) * 9;
        const side = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 6;
        const img = addSprite(this.scene, 'bird0', x0 - Math.sign(vx) * back, y0 + side).setDepth(BIRD_DEPTH);
        this.birds.push({ img, x: img.x, y: img.y, vx, vy, alt: 0, climb: 0, ttl: (view.width + 160) / Math.abs(vx) * 1000, phase: i });
      }
      return;
    }
    this.flapAt += dt;
    if (this.flapAt > 160) (this.flapAt = 0), (this.flap = 1 - this.flap);
    for (const b of this.birds) {
      b.x += b.vx * s;
      b.y += b.vy * s;
      b.ttl -= dt;
      b.img.setPosition(Math.round(b.x), Math.round(b.y)).setFrame(`bird${(this.flap + b.phase) % 2}`);
    }
    if (this.birds.every((b) => b.ttl <= 0)) {
      for (const b of this.birds) b.img.destroy();
      this.birds = [];
    }
  }

  /** Every 45–90 s (sooner with cross-Region links) a plane takes off over the gate and climbs out along the highway, or comes in. */
  private updatePlane(dt: number, s: number) {
    if (!this.plane) {
      this.planeWait -= dt;
      if (this.planeWait > 0 || !hasSprite('planeE')) return;
      this.planeWait = this.busyAir ? 25_000 + rand() * 30_000 : 45_000 + rand() * 45_000;
      const outbound = rand() < 0.6;
      const speed = 70;
      const far = 1400;
      const start = outbound ? { x: this.gate.x - this.out.x * 200, y: this.gate.y - this.out.y * 200 } : { x: this.gate.x + this.out.x * far, y: this.gate.y + this.out.y * far };
      const img = addSprite(this.scene, outbound ? 'planeE' : 'planeW', start.x, start.y).setDepth(PLANE_DEPTH);
      const shadow = hasSprite('planeShadow') ? addSprite(this.scene, 'planeShadow', start.x, start.y).setDepth(CLOUD_SHADOW_DEPTH).setAlpha(0.8) : undefined;
      const way = outbound ? 1 : -1;
      this.plane = {
        img,
        shadow,
        x: start.x,
        y: start.y,
        vx: this.out.x * speed * way,
        vy: this.out.y * speed * way,
        alt: outbound ? 40 : 180,
        climb: outbound ? 9 : -8,
        ttl: ((far + 200) / speed) * 1000,
      };
    }
    const p = this.plane;
    p.x += p.vx * s;
    p.y += p.vy * s;
    p.alt = Math.max(30, Math.min(200, p.alt + p.climb * s));
    p.ttl -= dt;
    p.img.setPosition(Math.round(p.x), Math.round(p.y - p.alt));
    // Further up, the shadow falls further off and fainter.
    p.shadow?.setPosition(Math.round(p.x + p.alt * 0.2), Math.round(p.y)).setAlpha(Math.max(0.15, 0.8 - p.alt / 300));
    if (p.ttl <= 0) {
      p.img.destroy();
      p.shadow?.destroy();
      this.plane = undefined;
    }
  }
}
