import Phaser from 'phaser';
import type { Rect } from '@/world/layout';
import { addSprite, hasSprite } from './assets';
import { cornerScreen, footprintDepth, type Iso } from './iso';
import { inView } from './labels';
import { reducedMotion } from './motion';
import { FADED } from './occlusion';
import { crisp, TEXT_FONT } from './SpeechBubble';
import { CSS, labelStyle } from './theme';

export interface LandmarkSpec {
  id: string;
  /** Atlas sprite for the current tier (e.g. lm:s3:2, construction3x3, hq:storage, plaza). */
  sprite: string;
  footprint: Rect;
  label: string;
  /** -1 hidden, 0 construction site, 1..4 Novice → Master. Specials use 1. */
  tier: number;
  showStars: boolean;
  /** Hide the name sign (small props like plaques). */
  noSign?: boolean;
  /** Texture key of the official AWS icon shown above the sign (a separate image, never baked into the atlas). */
  icon?: string;
}

/** A landmark = generated pixel building + optional night-lights layer + name sign. */
export class Landmark {
  readonly img: Phaser.GameObjects.Image;
  private lights?: Phaser.GameObjects.Image;
  private sign: Phaser.GameObjects.Text;
  private icon?: Phaser.GameObjects.Image;
  /** How many of this service's resources the account has (city.inventory), beside the sign. */
  private badge?: Phaser.GameObjects.Text;
  /** A fence round the lot when AWS doesn't offer this service in the city's Region. */
  private fence?: Phaser.GameObjects.Graphics;
  private closed?: string;
  /** v2.6: an AWS Health event hits this service in this Region (real AWS status, not the player's account). */
  private outage?: { severity: 'degradation' | 'disruption'; why: string };
  /** Reviewed flashcards for this service due again (🃏 on the sign). */
  private due = 0;
  private night = 0;
  private ui = 1;
  /** Where the sign belongs (world px), before it's kept inside the view. */
  private anchor = { x: 0, y: 0 };
  private bouncing = false;
  /** The level the sign shows (1–4 tiers, 5–7 with crowns, src/state/mastery.ts); defaults to the tier. */
  private level?: number;
  /** Gold crowns on the knowledge tower's tip (art/tiles/legend_art.py), and their night glow. */
  private crown?: Phaser.GameObjects.Image;
  private crownLights?: Phaser.GameObjects.Image;

  constructor(
    private scene: Phaser.Scene,
    private iso: Iso,
    readonly spec: LandmarkSpec,
  ) {
    const f = spec.footprint;
    const n = cornerScreen(iso, f.x, f.y);
    this.img = addSprite(scene, spec.sprite, n.x, n.y).setDepth(footprintDepth(iso, f));
    this.img.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 1 });
    if (hasSprite(`${spec.sprite}@lights`)) {
      this.lights = addSprite(scene, `${spec.sprite}@lights`, n.x, n.y)
        .setDepth(70_001) // above the night overlay so windows really glow
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0);
    }
    // Same words as the panel: "Lv 2", not stars.
    const stars = spec.showStars && spec.tier >= 1 ? ` · Lv ${spec.tier}` : '';
    const topY = this.img.getTopCenter().y ?? n.y;
    this.sign = crisp(
      scene.add
        .text(Math.round(n.x + ((f.w - f.h) * iso.halfW) / 2), Math.round(topY - 2), (spec.tier === 0 ? '🚧 ' : '') + spec.label + stars, labelStyle(TEXT_FONT, CSS.inkHi))
        .setOrigin(0.5, 1)
        .setDepth(40_000),
    );
    this.anchor = { x: this.sign.x, y: this.sign.y };
    if (spec.noSign) this.sign.setVisible(false);
    if (spec.icon && scene.textures.exists(spec.icon)) {
      // Integer world pixels: the 16px raster is drawn at scale 1, so camera zoom (always an integer) keeps it crisp.
      this.icon = scene.add.image(Math.round(this.sign.x), Math.round(this.sign.y), spec.icon).setOrigin(0.5, 1).setDepth(40_001);
    }
  }

  onClick(fn: () => void) {
    for (const o of [this.img, this.sign.setInteractive({ useHandCursor: true })]) {
      o.on('pointerup', (p: Phaser.Input.Pointer) => p.getDistance() < 8 && fn());
    }
  }

  /** 0 = day, 1 = full night: windows glow. */
  setNight(n: number) {
    this.night = n;
    // A disrupted building has lost power; a degraded one is half lit.
    this.lights?.setAlpha(this.outage?.severity === 'disruption' ? 0 : this.outage ? n * 0.5 : n);
    this.crownLights?.setAlpha(this.outage ? 0 : n);
  }

  /** Show "×n" beside the sign when the account has some here; nothing at 0 (a row of grey ×0s is noise). */
  setBadge(n: number) {
    if (n <= 0 || this.spec.noSign) {
      this.badge?.destroy();
      this.badge = undefined;
      return;
    }
    if (!this.badge) {
      this.badge = crisp(
        this.scene.add
          .text(0, 0, '', { fontFamily: TEXT_FONT, fontSize: '11px', fontStyle: '900', color: CSS.bg, backgroundColor: CSS.info, padding: { x: 3, y: 1 } })
          .setOrigin(0, 1)
          .setDepth(40_002),
      );
    }
    this.badge.setText(`×${n}`).setVisible(this.sign.visible);
    this.setUiScale(this.ui);
  }

  /**
   * Not offered in this Region: the building fades to a grey outline behind a fence, and the sign says why
   * (`why` = "Not in Cape Town · planned 2026 Q4"). null opens it again.
   */
  setClosed(why: string | null) {
    if ((why ?? undefined) === this.closed) return;
    this.closed = why ?? undefined;
    this.redraw();
  }

  /**
   * v2.6: AWS's Health Dashboard reports this service hit in this Region. The building stays (it isn't the player's
   * fault, and nothing of theirs is gone) but goes dark behind a red (disruption) or amber (degradation) fence, and
   * the sign says so. null clears it. A Region that doesn't offer the service shows that instead.
   */
  setOutage(severity: 'degradation' | 'disruption' | null, why = '') {
    const next = severity ? { severity, why } : undefined;
    if (next?.severity === this.outage?.severity && next?.why === this.outage?.why) return;
    this.outage = next;
    this.redraw();
    this.setNight(this.night);
  }

  /** Lv 5–7: a crown per level past Master stands on the tower's tip (only buildings with a tower: tier 4 sprites). */
  setLevel(level: number) {
    if (level === (this.level ?? this.spec.tier)) return;
    this.level = level;
    this.crown?.destroy();
    this.crownLights?.destroy();
    this.crown = this.crownLights = undefined;
    const crowns = level - 4;
    if (crowns >= 1 && hasSprite(`legend:${crowns}`)) {
      const top = this.img.getTopCenter();
      const x = Math.round(top.x ?? this.img.x);
      const y = Math.round((top.y ?? this.img.y) + 3);
      this.crown = addSprite(this.scene, `legend:${crowns}`, x, y).setDepth(this.img.depth + 0.5);
      if (hasSprite(`legend:${crowns}@lights`)) {
        this.crownLights = addSprite(this.scene, `legend:${crowns}@lights`, x, y).setDepth(70_001).setBlendMode(Phaser.BlendModes.ADD).setAlpha(this.night);
      }
      this.crown.setAlpha(this.img.alpha);
    }
    // The sign stands on the tallest thing: the crown's tip, else the roof.
    const top = (this.crown ?? this.img).getTopCenter().y ?? this.img.y;
    this.anchor = { x: this.anchor.x, y: Math.round(top - 2) };
    this.sign.setPosition(this.anchor.x, this.anchor.y);
    this.placeExtras();
    if (!this.closed && !this.outage) this.sign.setText(this.label());
  }

  /** World y of the building's highest point: the crown's tip, else its roof (the camera frames tall buildings by it). */
  get topY() {
    return (this.crown ?? this.img).getTopCenter().y ?? this.img.y;
  }

  /** A new crown: it drops onto the tower's tip with a little bounce. */
  crownDrop() {
    if (!this.crown || reducedMotion()) return;
    const y = this.crown.y;
    this.scene.tweens.add({ targets: [this.crown, this.crownLights].filter(Boolean), y: { from: y - 30, to: y }, duration: 700, ease: 'Bounce.easeOut' });
  }

  private label() {
    const level = this.level ?? this.spec.tier;
    const lv = this.spec.showStars && level >= 1 ? ` · Lv ${level}${level > 4 ? ' 👑' : ''}` : '';
    return (this.spec.tier === 0 ? '🚧 ' : '') + this.spec.label + lv + (this.due ? ` · 🃏 ${this.due}` : '');
  }

  /** Flashcards due for review at this building: a count on its sign (shown with the name, under the label budget). */
  setDue(n: number) {
    if (n === this.due) return;
    this.due = n;
    if (!this.closed && !this.outage) this.sign.setText(this.label());
  }

  private redraw() {
    this.fence?.destroy();
    this.fence = undefined;
    if (this.closed) {
      this.img.setTint(0x6b6680).setAlpha(0.35);
      this.lights?.setVisible(false);
      this.sign.setText(`⛔ ${this.spec.label}\n${this.closed}`).setColor(CSS.inkSoft).setAlign('center');
      this.drawFence(0xf0c060);
    } else if (this.outage) {
      const bad = this.outage.severity === 'disruption';
      this.img.setTint(bad ? 0x7a7488 : 0xa49eb0).setAlpha(1);
      this.lights?.setVisible(true);
      this.sign.setText(`${bad ? '⛈️' : '🌧️'} ${this.spec.label}\n${this.outage.why}`).setColor(bad ? CSS.badInk : CSS.goldHi).setAlign('center');
      this.drawFence(bad ? 0xe5676b : 0xe8c15a);
    } else {
      this.img.clearTint().setAlpha(this.faded ? FADED : 1);
      this.lights?.setVisible(true);
      this.sign.setText(this.label()).setColor(CSS.inkHi);
    }
    this.setUiScale(this.ui);
  }

  /** A post-and-rail fence round the lot: rails along each edge, a post every half tile. */
  private drawFence(color: number) {
    const f = this.spec.footprint;
    const P = (x: number, y: number) => cornerScreen(this.iso, x, y);
    const g = (this.fence = this.scene.add.graphics().setDepth(this.img.depth + 1));
    const corners = [P(f.x, f.y), P(f.x + f.w, f.y), P(f.x + f.w, f.y + f.h), P(f.x, f.y + f.h)];
    g.lineStyle(1, color, 0.9);
    corners.forEach((c, i) => {
      const d = corners[(i + 1) % 4];
      g.lineBetween(c.x, c.y - 4, d.x, d.y - 4).lineBetween(c.x, c.y - 1, d.x, d.y - 1);
      const steps = Math.max(2, Math.round(Math.hypot(d.x - c.x, d.y - c.y) / 8));
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(c.x + ((d.x - c.x) * k) / steps);
        const y = Math.round(c.y + ((d.y - c.y) * k) / steps);
        g.lineBetween(x, y, x, y - 6);
      }
    });
  }

  get hasOutage() {
    return !!this.outage && !this.closed;
  }

  get isClosed() {
    return !!this.closed;
  }

  setUiScale(s: number) {
    this.ui = s;
    this.sign.setScale(s);
    this.placeExtras();
  }

  /** The badge beside the sign and the icon just above it (the sign is counter-scaled), on whole world pixels. */
  private placeExtras() {
    const s = this.ui;
    this.badge?.setScale(s).setPosition(Math.round(this.sign.x + (this.sign.width * s) / 2 + 1), Math.round(this.sign.y));
    this.icon?.setPosition(Math.round(this.sign.x), Math.round(this.sign.y - this.sign.height * s - 1));
  }

  get signShown() {
    return this.sign.visible;
  }

  /** The sign's bounds (world px) while it shows, for the scene's overlap check. */
  signBounds() {
    return this.sign.visible ? this.sign.getBounds() : undefined;
  }

  showSign(on: boolean) {
    this.sign.setVisible(on && !this.spec.noSign);
    this.icon?.setVisible(on && !this.spec.noSign);
    this.badge?.setVisible(on && !this.spec.noSign);
  }

  /** Per frame while the sign shows: slide it (with its icon and badge) to stay whole inside the camera view. */
  keepInView(view: Phaser.Geom.Rectangle, topInset = 0) {
    if (!this.sign.visible || this.bouncing) return;
    const s = this.ui;
    const iconH = this.icon ? this.icon.height + 1 : 0;
    const badgeW = this.badge ? this.badge.width * s + 1 : 0;
    const w = this.sign.displayWidth + 2 * badgeW;
    const h = this.sign.displayHeight + iconH;
    const p = inView(this.anchor, w, h, view, 4 * s, topInset * s, 0.5, 1);
    if (p.x === this.sign.x && p.y === this.sign.y) return;
    this.sign.setPosition(p.x, p.y);
    this.placeExtras();
  }

  /** True while a tall building in front of what the player follows is see-through (src/game/occlusion.ts). */
  private faded = false;
  setFaded(on: boolean) {
    if (on === this.faded || this.closed) return;
    this.faded = on;
    this.scene.tweens.add({ targets: [this.img, this.crown].filter(Boolean), alpha: on ? FADED : 1, duration: 180 });
  }

  /** A pixel of the building (not its transparent margin) at world (x, y), for the fade's outline test. */
  solidAt(x: number, y: number) {
    const local = this.img.getLocalPoint(x, y);
    const f = this.img.frame;
    return this.scene.textures.getPixelAlpha(Math.floor(local.x), Math.floor(local.y), f.texture.key, f.name) > 0;
  }

  /**
   * A level-up: the new building rises out of the ground floor by floor (8 px steps), then bounces. `done` runs at the
   * end. Reduced motion shows it at once.
   */
  rise(done?: () => void) {
    const h = this.img.height;
    if (reducedMotion() || h < 16) return done?.();
    const floors = Math.ceil(h / 8);
    const layers = [this.img, this.lights].filter((o): o is Phaser.GameObjects.Image => !!o);
    const show = (k: number) => layers.forEach((o) => o.setCrop(0, Math.max(0, o.height - k * 8 * (o.height / h)), o.width, o.height));
    show(0);
    this.scene.tweens.addCounter({
      from: 0,
      to: floors,
      duration: Math.min(1400, 300 + floors * 30),
      ease: 'Quad.easeOut',
      onUpdate: (tw) => show(Math.round(tw.getValue() ?? floors)),
      onComplete: () => {
        layers.forEach((o) => o.setCrop());
        done?.();
      },
    });
  }

  celebrate() {
    this.bouncing = true;
    this.scene.tweens.add({
      targets: [this.img, this.lights, this.crown, this.crownLights, this.sign, this.icon].filter(Boolean),
      y: '-=6',
      yoyo: true,
      duration: 160,
      repeat: 2,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.bouncing = false;
      },
    });
  }

  destroy() {
    this.crown?.destroy();
    this.crownLights?.destroy();
    this.img.destroy();
    this.lights?.destroy();
    this.sign.destroy();
    this.icon?.destroy();
    this.badge?.destroy();
    this.fence?.destroy();
  }
}
