import Phaser from 'phaser';
import type { LandmarkKind } from '@/world/places';
import type { Rect } from '@/world/layout';
import { entityDepth, toScreen, type Iso } from './iso';
import { UI_FONT } from './SpeechBubble';

/** Flat-shaded iso primitives that match Kenney's tile style. */
export class IsoPainter {
  constructor(
    private g: Phaser.GameObjects.Graphics,
    private iso: Iso,
  ) {}

  p(gx: number, gy: number, z = 0) {
    const s = toScreen(this.iso, gx, gy);
    return new Phaser.Math.Vector2(s.x, s.y - z);
  }

  /** Box over a grid rect (tile units, edges at ±0.5), from height z0 to z1 (px). */
  box(r: Rect, z0: number, z1: number, color: number, opts: { top?: number; inset?: number } = {}) {
    const i = opts.inset ?? 0;
    const x0 = r.x - 0.5 + i;
    const y0 = r.y - 0.5 + i;
    const x1 = r.x + r.w - 0.5 - i;
    const y1 = r.y + r.h - 0.5 - i;
    const N = (z: number) => this.p(x0, y0, z);
    const E = (z: number) => this.p(x1, y0, z);
    const S = (z: number) => this.p(x1, y1, z);
    const W = (z: number) => this.p(x0, y1, z);
    const left = shade(color, 0.78);
    const right = shade(color, 0.62);
    this.poly([W(z0), S(z0), S(z1), W(z1)], left);
    this.poly([S(z0), E(z0), E(z1), S(z1)], right);
    this.poly([N(z1), E(z1), S(z1), W(z1)], opts.top ?? shade(color, 1.08));
    return { N, E, S, W, x0, y0, x1, y1 };
  }

  /** Small square box centred on a grid point (for posts, props). */
  boxAt(cx: number, cy: number, size: number, z0: number, z1: number, color: number) {
    return this.box({ x: cx - size / 2 + 0.5, y: cy - size / 2 + 0.5, w: size, h: size }, z0, z1, color);
  }

  /** Pyramid roof on top of a rect at height z. */
  roof(r: Rect, z: number, h: number, color: number, inset = 0) {
    const x0 = r.x - 0.5 + inset;
    const y0 = r.y - 0.5 + inset;
    const x1 = r.x + r.w - 0.5 - inset;
    const y1 = r.y + r.h - 0.5 - inset;
    const apex = this.p((x0 + x1) / 2, (y0 + y1) / 2, z + h);
    this.poly([this.p(x0, y1, z), this.p(x1, y1, z), apex], shade(color, 0.85));
    this.poly([this.p(x1, y1, z), this.p(x1, y0, z), apex], shade(color, 0.68));
    return apex;
  }

  /** Windows along the two visible faces. */
  windows(r: Rect, z0: number, z1: number, inset: number, lit: boolean) {
    const x1 = r.x + r.w - 0.5 - inset;
    const y1 = r.y + r.h - 0.5 - inset;
    const x0 = r.x - 0.5 + inset;
    const y0 = r.y - 0.5 + inset;
    const c = lit ? 0xfde68a : 0x93c5fd;
    const rows = Math.max(1, Math.floor((z1 - z0 - 10) / 22));
    for (let row = 0; row < rows; row++) {
      const za = z0 + 10 + row * 22;
      const zb = za + 11;
      for (let t = 0.2; t < 0.9; t += 0.3) {
        // left face (W→S): x varies from x0 to x1 along y = y1
        const lx = x0 + (x1 - x0) * t;
        this.poly([this.p(lx, y1, za), this.p(lx + 0.14, y1, za), this.p(lx + 0.14, y1, zb), this.p(lx, y1, zb)], c);
        // right face (S→E): y varies from y1 to y0 along x = x1
        const ry = y1 - (y1 - y0) * t;
        this.poly([this.p(x1, ry, za), this.p(x1, ry - 0.14, za), this.p(x1, ry - 0.14, zb), this.p(x1, ry, zb)], shade(c, 0.85));
      }
    }
  }

  /** Door on the left (south-west) face. */
  door(r: Rect, inset: number, color = 0x3f2a14) {
    const y1 = r.y + r.h - 0.5 - inset;
    const mid = r.x - 0.5 + inset + (r.w - inset * 2) / 2;
    this.poly([this.p(mid - 0.14, y1, 0), this.p(mid + 0.14, y1, 0), this.p(mid + 0.14, y1, 24), this.p(mid - 0.14, y1, 24)], color);
  }

  poly(pts: Phaser.Math.Vector2[], color: number, alpha = 1) {
    this.g.fillStyle(color, alpha);
    this.g.fillPoints(pts, true);
    this.g.lineStyle(1, shade(color, 0.55), 0.6);
    this.g.strokePoints(pts, true);
  }
}

export function shade(c: number, f: number) {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}

export interface LandmarkSpec {
  id: string;
  kind: LandmarkKind | 'hq' | 'plaza' | 'lookout';
  footprint: Rect;
  color: number;
  label: string;
  /** -1 hidden, 0 construction site, 1..4 Foundation → Expert. */
  tier: number;
}

/** A landmark drawn with Graphics. Rebuild it (destroy + new) when its tier changes. */
export class Landmark {
  readonly g: Phaser.GameObjects.Graphics;
  private sign: Phaser.GameObjects.Text;
  private painter: IsoPainter;
  private topY = Infinity;

  constructor(
    private scene: Phaser.Scene,
    private iso: Iso,
    readonly spec: LandmarkSpec,
  ) {
    this.g = scene.add.graphics();
    this.painter = new IsoPainter(this.g, iso);
    const f = spec.footprint;
    const front = toScreen(iso, f.x + f.w - 1, f.y + f.h - 1);
    this.g.setDepth(entityDepth(front.y));
    this.draw();

    const stars = spec.tier >= 1 && !['hq', 'plaza', 'lookout'].includes(spec.kind) ? '\n' + '★'.repeat(spec.tier) + '☆'.repeat(4 - spec.tier) : '';
    const c = toScreen(iso, f.x + (f.w - 1) / 2, f.y + (f.h - 1) / 2);
    this.sign = scene.add
      .text(c.x, Math.min(c.y - 20, this.topY - 6), (spec.tier === 0 ? '🚧 ' : '') + spec.label + stars, {
        fontFamily: UI_FONT,
        fontSize: '12px',
        fontStyle: 'bold',
        align: 'center',
        color: '#ffffff',
        backgroundColor: '#161622d9',
        padding: { x: 6, y: 3 },
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(40_000);

    // Clickable footprint (the ground diamond plus the building above it).
    const P = (gx: number, gy: number, z = 0) => this.painter.p(gx, gy, z);
    const h = Math.max(30, c.y - this.topY);
    const hit = new Phaser.Geom.Polygon([
      P(f.x - 0.5, f.y - 0.5, h), P(f.x + f.w - 0.5, f.y - 0.5, h), P(f.x + f.w - 0.5, f.y - 0.5),
      P(f.x + f.w - 0.5, f.y + f.h - 0.5), P(f.x - 0.5, f.y + f.h - 0.5), P(f.x - 0.5, f.y + f.h - 0.5, h),
    ]);
    this.g.setInteractive(hit, Phaser.Geom.Polygon.Contains);
    if (this.g.input) this.g.input.cursor = 'pointer';
  }

  onClick(fn: () => void) {
    this.g.on('pointerup', (p: Phaser.Input.Pointer) => p.getDistance() < 8 && fn());
    this.sign.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => p.getDistance() < 8 && fn());
  }

  setUiScale(s: number) {
    this.sign.setScale(s);
  }

  /** Short celebratory bounce, e.g. on tier-up. */
  celebrate() {
    this.scene.tweens.add({ targets: [this.g, this.sign], y: '-=10', yoyo: true, duration: 180, repeat: 2, ease: 'Quad.easeOut' });
  }

  destroy() {
    this.g.destroy();
    this.sign.destroy();
  }

  private draw() {
    const { kind, footprint: f, tier, color } = this.spec;
    const P = this.painter;
    const top = (z: number) => (this.topY = Math.min(this.topY, P.p(f.x + (f.w - 1) / 2, f.y + (f.h - 1) / 2, z).y));
    if (tier < 0) return;
    if (tier === 0) return this.drawConstruction(top);

    switch (kind) {
      case 'plaza': {
        P.box(f, 0, 46, 0x232f3e, { inset: 0.1 });
        P.windows(f, 0, 46, 0.1, true);
        P.door(f, 0.1, 0xff9900);
        P.box(f, 46, 54, 0xff9900, { inset: 0.02 });
        top(54);
        break;
      }
      case 'lookout': {
        const c = { x: f.x, y: f.y, w: 1, h: 1 };
        // stilts
        for (const [dx, dy] of [[-0.35, -0.35], [0.35, -0.35], [0.35, 0.35], [-0.35, 0.35]]) P.boxAt(c.x + dx, c.y + dy, 0.1, 0, 80, 0x8b5a2b);
        P.box(c, 80, 90, 0xa16207, { inset: -0.05 });
        P.box(c, 90, 110, 0x94a3b8, { inset: 0.2 });
        P.roof(c, 110, 18, 0x475569, 0.05);
        top(128);
        break;
      }
      case 'hq': {
        P.box(f, 0, 58, 0xe5e7eb, { inset: 0.12 });
        P.windows(f, 0, 58, 0.12, false);
        P.door(f, 0.12, color);
        P.box(f, 58, 66, color, { inset: 0.06 });
        top(66);
        break;
      }
      case 'building': {
        const h = 34 + 20 * (tier - 1);
        P.box(f, 0, h, 0xf1ece2, { inset: 0.18 });
        P.windows(f, 0, h, 0.18, tier >= 3);
        P.door(f, 0.18);
        if (tier >= 3) {
          const upper = { x: f.x + 0.5, y: f.y + 0.5, w: f.w - 1, h: f.h - 1 };
          P.box(upper, h, h + 26, shade(color, 1.2), { inset: 0.1 });
          P.roof(upper, h + 26, 22 + (tier === 4 ? 12 : 0), tier === 4 ? 0xfacc15 : color, 0.02);
          top(h + 48);
        } else {
          P.roof(f, h, 26, color, 0.1);
          top(h + 26);
        }
        break;
      }
      case 'lake': {
        // water tiles come from the ground layer; draw a pier and one bucket per tier
        const pier = { x: f.x, y: f.y + f.h - 1, w: f.w, h: 1 };
        P.box({ ...pier, y: pier.y + 0.25, h: 0.5 }, 0, 6, 0x8b5a2b, { top: 0xa0703f });
        for (let i = 0; i < tier; i++) {
          const b = { x: f.x + i * 0.7 - 0.1, y: pier.y + 0.35, w: 0.3, h: 0.3 };
          P.box(b, 6, 18, [0x3f9b4f, 0x3a6fd8, 0x94a3b8, 0xfacc15][i]);
        }
        if (tier >= 3) {
          const house = { x: f.x + f.w - 1, y: f.y, w: 1, h: 1 };
          P.box(house, 0, 30, 0xa0703f, { inset: 0.1 });
          P.roof(house, 30, 16, color, 0.05);
        }
        top(tier >= 3 ? 46 : 20);
        break;
      }
      case 'wall': {
        const w = { x: f.x, y: f.y + 1, w: f.w, h: 1 };
        const h = 26 + tier * 10;
        P.box(w, 0, h, tier === 4 ? 0xe5c07b : 0x9ca3af, { inset: 0.25 });
        for (let i = 0; i < f.w * 2; i++) {
          const cx = f.x - 0.25 + i * 0.5;
          P.box({ x: cx + 0.1, y: w.y, w: 0.25, h: 1 }, h, h + 8, 0x9ca3af, { inset: 0.25 });
        }
        // shield emblem
        const c = P.p(f.x + f.w / 2 - 0.5, w.y + 0.25, h / 2 + 4);
        this.g.fillStyle(color, 1).fillRoundedRect(c.x - 10, c.y - 12, 20, 24, 6);
        this.g.fillStyle(0xffffff, 1).fillRect(c.x - 2, c.y - 8, 4, 16).fillRect(c.x - 7, c.y - 2, 14, 4);
        top(h + 8);
        break;
      }
      case 'tower': {
        const c = { x: f.x + 1, y: f.y + 1, w: 1, h: 1 };
        const h = 60 + tier * 22;
        P.box({ x: f.x, y: f.y + 1, w: f.w, h: 1 }, 0, 26, 0xd6d3d1, { inset: 0.2 });
        P.box(c, 0, h, 0xe7e5e4, { inset: 0.05 });
        P.windows(c, 20, h, 0.05, tier >= 3);
        const apex = P.roof(c, h, 30, color, -0.05);
        if (this.spec.id === 'bedrock') this.g.fillStyle(0x5eead4, 0.9).fillCircle(apex.x, apex.y - 6, 7);
        top(h + 36);
        break;
      }
      case 'garden': {
        const hedge = 0x2f7d32;
        P.box({ x: f.x, y: f.y, w: f.w, h: 0.3 }, 0, 14, hedge, { inset: 0 });
        P.box({ x: f.x, y: f.y, w: 0.3, h: f.h }, 0, 14, hedge, { inset: 0 });
        P.box({ x: f.x + f.w - 0.3, y: f.y, w: 0.3, h: f.h }, 0, 14, hedge);
        P.box({ x: f.x, y: f.y + f.h - 0.3, w: 1.1, h: 0.3 }, 0, 14, hedge);
        P.box({ x: f.x + 1.9, y: f.y + f.h - 0.3, w: 1.1, h: 0.3 }, 0, 14, hedge);
        for (let i = 0; i < tier + 1; i++) {
          const t = P.p(f.x + 0.4 + (i % 2) * 1.3, f.y + 0.4 + Math.floor(i / 2) * 1.1, 0);
          this.g.fillStyle(0x8b5a2b, 1).fillRect(t.x - 2, t.y - 16, 4, 16);
          this.g.fillStyle(0x4caf50, 1).fillCircle(t.x, t.y - 22, 10);
        }
        top(30);
        break;
      }
      case 'stall': {
        const s = { x: f.x, y: f.y + 1, w: f.w, h: 1.4 };
        P.box(s, 0, 24, 0xa0703f, { inset: 0.25 });
        // striped awning
        for (let i = 0; i < 6; i++) {
          const x0 = f.x - 0.25 + i * 0.5;
          P.box({ x: x0 + 0.5, y: f.y + 0.75, w: 0.5, h: 1.9 }, 44, 48, i % 2 ? 0xffffff : color);
        }
        for (const px of [f.x - 0.3, f.x + f.w - 0.7]) P.boxAt(px, f.y + 2.1, 0.1, 0, 44, 0x6b4423);
        if (tier >= 2) P.box({ x: f.x + 0.2, y: f.y + 2.4, w: 0.6, h: 0.5 }, 0, 12, 0xd6d3d1);
        top(48);
        break;
      }
      case 'dome': {
        const h = 26 + tier * 6;
        P.box(f, 0, h, 0xe7e5e4, { inset: 0.2 });
        P.door(f, 0.2);
        const c = P.p(f.x + (f.w - 1) / 2, f.y + (f.h - 1) / 2, h);
        const r = (f.w / 2 - 0.3) * this.iso.halfW;
        this.g.fillStyle(shade(color, 1.1), 1).slice(c.x, c.y, r, Math.PI, 0, false).fillPath();
        this.g.fillStyle(0xffffff, 0.25).fillEllipse(c.x - r * 0.35, c.y - r * 0.55, r * 0.4, r * 0.25);
        if (tier >= 3) this.g.lineStyle(5, 0x475569, 1).lineBetween(c.x, c.y - r * 0.7, c.x + r * 0.8, c.y - r * 1.2);
        top(h + r);
        break;
      }
      case 'dock': {
        P.box({ x: f.x, y: f.y + f.h - 1, w: f.w, h: 1 }, 0, 6, 0x8b5a2b, { top: 0xa0703f });
        const cols = [0xef4444, 0x3b82f6, 0x22c55e, 0xf59e0b, 0x8b5cf6, 0x14b8a6, 0xec4899, 0x64748b];
        for (let i = 0; i < tier * 2; i++) {
          const b = { x: f.x + (i % 3) * 1, y: f.y + Math.floor(i / 3) * 0.9, w: 0.9, h: 0.6 };
          const z = Math.floor(i / 6) * 18;
          P.box(b, z, z + 18, cols[i % cols.length], { inset: 0.05 });
        }
        top(40);
        break;
      }
    }
  }

  private drawConstruction(top: (z: number) => void) {
    const f = this.spec.footprint;
    const P = this.painter;
    // fence posts around the lot
    for (let i = 0; i <= f.w; i++) {
      const x = f.x - 0.45 + (i * (f.w - 0.1)) / f.w;
      P.boxAt(x, f.y - 0.45, 0.1, 0, 14, 0xfacc15);
      P.boxAt(x, f.y + f.h - 0.55, 0.1, 0, 14, 0xfacc15);
    }
    // scaffold frame
    const g = this.g;
    const s = (gx: number, gy: number, z: number) => P.p(gx, gy, z);
    g.lineStyle(3, 0x78716c, 1);
    const cx = f.x + (f.w - 1) / 2;
    const cy = f.y + (f.h - 1) / 2;
    for (const [dx, dy] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) {
      const a = s(cx + dx, cy + dy, 0);
      const b = s(cx + dx, cy + dy, 48);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (const z of [24, 48]) {
      const pts = [s(cx - 0.8, cy - 0.8, z), s(cx + 0.8, cy - 0.8, z), s(cx + 0.8, cy + 0.8, z), s(cx - 0.8, cy + 0.8, z)];
      g.strokePoints(pts, true);
    }
    // cones + crate
    P.box({ x: cx + 0.6, y: cy + 1, w: 0.4, h: 0.4 }, 0, 14, 0xb45309);
    const cone = s(cx - 0.9, cy + 1.1, 0);
    g.fillStyle(0xf97316, 1).fillTriangle(cone.x - 6, cone.y, cone.x + 6, cone.y, cone.x, cone.y - 16);
    top(48);
  }
}
