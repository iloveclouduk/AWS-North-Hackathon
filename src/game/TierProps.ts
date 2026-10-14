// A little extra round a landmark as it levels up: a flag in its district's colour at Novice, a bench at Practitioner,
// a paved plaza in front at Expert (the ground, CityMap.groundKey via frontRowTiles), and a gentle sparkle when the
// player visits a Master landmark. Cheap: at most two Images a landmark, no tweens except the visit's sparkle (none
// under reduced motion). The props stand on the row in front of the lot, which decor always leaves clear, and never
// block a tile (walkers pass them as they pass a bench).
import Phaser from 'phaser';
import { LANDMARKS, type LandmarkLayout, type Tile } from '@/world/layout';
import { districtById, serviceById } from '@/world/taxonomy';
import { addSprite, hasSprite } from './assets';
import { CITY_ISO, cornerScreen, entityDepth, footprintDepth, toScreen } from './iso';
import { reducedMotion } from './motion';
import { constructionStage } from '@/state/growth';
import { ensureFlagTexture, ensureSparkleTexture, PROP_ORIGIN } from './propArt';

export const TIER_FLAG = 1;
export const TIER_BENCH = 2;
export const TIER_PLAZA = 3;
export const TIER_SPARKLE = 4;
const SPARKS = 5;

/** The row in front of a service landmark's lot: the tiles a tier-3 plaza paves (the middle one is its work spot). */
export const frontRowTiles = (l: LandmarkLayout): Tile[] => Array.from({ length: l.footprint.w }, (_, i) => ({ x: l.footprint.x + i, y: l.footprint.y + l.footprint.h }));

export class TierProps {
  private items = new Map<string, { tier: number; imgs: Phaser.GameObjects.Image[] }>();
  private works = new Map<string, { stage: number; imgs: Phaser.GameObjects.Image[] }>();
  private sparks: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene) {}

  get count() {
    let n = this.sparks.length;
    for (const v of this.items.values()) n += v.imgs.length;
    for (const v of this.works.values()) n += v.imgs.length;
    return n;
  }

  /** Construction stages for each built landmark from how far it is to its next level (0..1, `top` when fully grown). */
  syncWorks(growth: (id: string) => { tier: number; pct: number; top: boolean } | undefined) {
    for (const l of LANDMARKS) {
      if (!serviceById(l.id)) continue;
      const g = growth(l.id);
      const stage = g && g.tier >= 0 ? constructionStage(g.pct, g.top) : 0;
      const cur = this.works.get(l.id);
      if ((cur?.stage ?? 0) === stage) continue;
      cur?.imgs.forEach((i) => i.destroy());
      this.works.delete(l.id);
      if (stage) this.works.set(l.id, { stage, imgs: this.buildWorks(l, stage) });
    }
  }

  private buildWorks(l: LandmarkLayout, stage: number) {
    const f = l.footprint;
    const imgs: Phaser.GameObjects.Image[] = [];
    const over = footprintDepth(CITY_ISO, f) + 1;
    // Scaffolding on the front corner, drawn over the building (it wraps its face).
    if (hasSprite('scaffold1x1')) {
      const n = cornerScreen(CITY_ISO, f.x + f.w - 1, f.y + f.h - 1);
      imgs.push(addSprite(this.scene, 'scaffold1x1', n.x, n.y).setDepth(over));
    }
    // The crane stands at the back corner, behind the building, its jib over the roof.
    if (stage >= 2 && hasSprite('crane1x1')) {
      const n = cornerScreen(CITY_ISO, f.x + f.w - 1, f.y);
      imgs.push(addSprite(this.scene, 'crane1x1', n.x, n.y).setDepth(footprintDepth(CITY_ISO, f) - 1));
      if (hasSprite('crane1x1@lights')) imgs.push(addSprite(this.scene, 'crane1x1@lights', n.x, n.y).setDepth(70_001).setBlendMode(Phaser.BlendModes.ADD).setAlpha(this.night));
    }
    return imgs;
  }

  private night = 0;
  /** The crane's beacon at night. */
  setNight(n: number) {
    this.night = n;
    for (const v of this.works.values()) for (const i of v.imgs) if (i.blendMode === Phaser.BlendModes.ADD) i.setAlpha(n);
  }

  /** Each built service landmark's tier (-1 or 0: nothing extra). Diffed: only a landmark whose tier changed is redrawn. */
  sync(tierOf: (id: string) => number) {
    for (const l of LANDMARKS) {
      if (!serviceById(l.id)) continue;
      const tier = Math.max(0, tierOf(l.id));
      const cur = this.items.get(l.id);
      if ((cur?.tier ?? 0) === tier) continue;
      cur?.imgs.forEach((i) => i.destroy());
      this.items.delete(l.id);
      if (tier >= TIER_FLAG) this.items.set(l.id, { tier, imgs: this.build(l, tier) });
    }
  }

  private build(l: LandmarkLayout, tier: number) {
    const row = frontRowTiles(l);
    const imgs: Phaser.GameObjects.Image[] = [];
    const color = districtById(l.districtId ?? '')?.color ?? 0xff9900;
    const left = row[0];
    const c = toScreen(CITY_ISO, left.x, left.y);
    imgs.push(this.scene.add.image(Math.round(c.x - 6), Math.round(c.y), ensureFlagTexture(this.scene, color)).setOrigin(PROP_ORIGIN.x, PROP_ORIGIN.y).setDepth(entityDepth(c.y)));
    if (tier >= TIER_BENCH && hasSprite('benchX')) {
      const right = row[row.length - 1];
      const n = cornerScreen(CITY_ISO, right.x, right.y);
      imgs.push(addSprite(this.scene, 'benchX', n.x, n.y).setDepth(entityDepth(toScreen(CITY_ISO, right.x, right.y).y)));
    }
    return imgs;
  }

  /** A Master landmark visited: a few soft twinkles over it, once. Nothing under reduced motion. */
  sparkle(id: string, tier: number) {
    if (tier < TIER_SPARKLE || reducedMotion() || this.sparks.length) return;
    const l = LANDMARKS.find((x) => x.id === id);
    if (!l) return;
    const f = l.footprint;
    const c = toScreen(CITY_ISO, f.x + (f.w - 1) / 2, f.y + (f.h - 1) / 2);
    const key = ensureSparkleTexture(this.scene);
    for (let i = 0; i < SPARKS; i++) {
      const s = this.scene.add
        .image(Math.round(c.x + (i - 2) * 11 + (i % 2) * 4), Math.round(c.y - 40 - (i % 3) * 9), key)
        .setDepth(58_000)
        .setAlpha(0);
      this.sparks.push(s);
      this.scene.tweens.add({
        targets: s,
        alpha: { from: 0, to: 1 },
        y: s.y - 6,
        yoyo: true,
        delay: i * 140,
        duration: 420,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          s.destroy();
          this.sparks = this.sparks.filter((x) => x !== s);
        },
      });
    }
  }

  destroy() {
    for (const v of this.items.values()) v.imgs.forEach((i) => i.destroy());
    this.items.clear();
    for (const v of this.works.values()) v.imgs.forEach((i) => i.destroy());
    this.works.clear();
    for (const s of this.sparks) s.destroy();
    this.sparks = [];
  }
}
