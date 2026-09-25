import Phaser from 'phaser';
import type { Rect } from '@/world/layout';
import { addSprite, hasSprite } from './assets';
import { cornerScreen, entityDepth, toScreen, type Iso } from './iso';
import { PIXEL_FONT } from './SpeechBubble';

export interface LandmarkSpec {
  id: string;
  /** Atlas sprite for the current tier (e.g. lm:s3:2, construction3x3, hq:storage, plaza). */
  sprite: string;
  footprint: Rect;
  label: string;
  /** -1 hidden, 0 construction site, 1..4 Foundation → Expert. Specials use 1. */
  tier: number;
  showStars: boolean;
}

/** A landmark = generated pixel building + optional night-lights layer + name sign. */
export class Landmark {
  readonly img: Phaser.GameObjects.Image;
  private lights?: Phaser.GameObjects.Image;
  private sign: Phaser.GameObjects.Text;

  constructor(
    private scene: Phaser.Scene,
    iso: Iso,
    readonly spec: LandmarkSpec,
  ) {
    const f = spec.footprint;
    const n = cornerScreen(iso, f.x, f.y);
    const front = toScreen(iso, f.x + f.w - 1, f.y + f.h - 1);
    this.img = addSprite(scene, spec.sprite, n.x, n.y).setDepth(entityDepth(front.y));
    this.img.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 1 });
    if (hasSprite(`${spec.sprite}@lights`)) {
      this.lights = addSprite(scene, `${spec.sprite}@lights`, n.x, n.y)
        .setDepth(entityDepth(front.y) + 0.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0);
    }
    const stars = spec.showStars && spec.tier >= 1 ? ` ${'★'.repeat(spec.tier)}${'☆'.repeat(4 - spec.tier)}` : '';
    const topY = this.img.getTopCenter().y ?? n.y;
    this.sign = scene.add
      .text(n.x + ((f.w - f.h) * iso.halfW) / 2, topY - 2, (spec.tier === 0 ? '🚧 ' : '') + spec.label + stars, {
        fontFamily: PIXEL_FONT,
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: '#161622d9',
        padding: { x: 4, y: 0 },
      })
      .setOrigin(0.5, 1)
      .setDepth(40_000);
  }

  onClick(fn: () => void) {
    for (const o of [this.img, this.sign.setInteractive({ useHandCursor: true })]) {
      o.on('pointerup', (p: Phaser.Input.Pointer) => p.getDistance() < 8 && fn());
    }
  }

  /** 0 = day, 1 = full night: windows glow. */
  setNight(n: number) {
    this.lights?.setAlpha(n);
  }

  setUiScale(s: number) {
    this.sign.setScale(s);
  }

  showSign(on: boolean) {
    this.sign.setVisible(on);
  }

  celebrate() {
    this.scene.tweens.add({ targets: [this.img, this.lights, this.sign].filter(Boolean), y: '-=6', yoyo: true, duration: 160, repeat: 2, ease: 'Quad.easeOut' });
  }

  destroy() {
    this.img.destroy();
    this.lights?.destroy();
    this.sign.destroy();
  }
}
