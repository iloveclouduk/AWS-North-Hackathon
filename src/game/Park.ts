// re:Play Park in the city (src/world/park.ts lays it out): six rides on the terrain's park site, each open once its
// service's building reaches Practitioner here, else under wraps. Open rides turn (three frames, still under reduced
// motion) and light up at night; tapping a ride opens its building's card; hovering a closed one says what opens it.
import Phaser from 'phaser';
import type { Progress } from '@/backend/contract';
import { parkLayout, rideHint, type ParkPiece } from '@/world/park';
import type { Rect } from '@/world/layout';
import { useCity } from '@/state/store';
import { bus } from '@/state/bus';
import { addSprite, hasSprite } from './assets';
import { click } from './audio';
import { CITY_ISO, cornerScreen, footprintDepth } from './iso';
import { reducedMotion } from './motion';
import { crisp, TEXT_FONT } from './SpeechBubble';
import { CSS, labelStyle } from './theme';

const FRAME_MS = 260;

interface Placed {
  piece: ParkPiece;
  img: Phaser.GameObjects.Image;
  lights?: Phaser.GameObjects.Image;
}

export class Park {
  private placed: Placed[] = [];
  private key = '';
  private frame = 0;
  private frameAt = 0;
  private night = 0;
  private tip?: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene) {}

  /** Lays the park out on `site` for this progress; only rebuilds when a ride opened or closed (or the site moved). */
  sync(site: Rect | undefined, p: Progress, region: string) {
    const pieces = site ? parkLayout(site, p, region) : [];
    const key = `${site ? `${site.x},${site.y}` : '-'}|${pieces.map((x) => x.sprite).join(',')}`;
    if (key === this.key) return;
    this.key = key;
    this.clear();
    for (const piece of pieces) {
      if (!hasSprite(piece.sprite)) continue;
      const n = cornerScreen(CITY_ISO, piece.x, piece.y);
      const depth = footprintDepth(CITY_ISO, piece);
      const img = addSprite(this.scene, piece.sprite, n.x, n.y).setDepth(depth);
      const lit = `${piece.sprite}@lights`;
      const lights = hasSprite(lit) ? addSprite(this.scene, lit, n.x, n.y).setDepth(70_001).setBlendMode(Phaser.BlendModes.ADD).setAlpha(this.night) : undefined;
      if (piece.ride) {
        const ride = piece.ride;
        img.setInteractive({ useHandCursor: true, pixelPerfect: true });
        img.on('pointerup', () => {
          click();
          useCity.getState().select(ride.serviceId);
          bus.emit('select', { id: ride.serviceId });
        });
        img.on('pointerover', () => this.showTip(img, piece.open ? `🎢 ${ride.name}` : `🚧 ${rideHint(ride)}`));
        img.on('pointerout', () => this.hideTip());
      }
      this.placed.push({ piece, img, lights });
    }
  }

  setNight(n: number) {
    this.night = n;
    for (const p of this.placed) p.lights?.setAlpha(n);
  }

  /** Per frame: open rides turn. */
  animate(time: number) {
    if (reducedMotion() || time - this.frameAt < FRAME_MS) return;
    this.frameAt = time;
    this.frame = (this.frame + 1) % 3;
    for (const p of this.placed) {
      const r = p.piece.ride;
      if (!r || !p.piece.open || !r.frames) continue;
      const f = `park:${r.id}${this.frame}`;
      if (hasSprite(f)) p.img.setFrame(f);
      if (p.lights && hasSprite(`${f}@lights`)) p.lights.setFrame(`${f}@lights`);
    }
  }

  private showTip(img: Phaser.GameObjects.Image, text: string) {
    this.hideTip();
    const top = img.getTopCenter();
    const zoom = this.scene.cameras.main.zoom || 1;
    this.tip = crisp(this.scene.add.text(Math.round(top.x ?? 0), Math.round((top.y ?? 0) - 4), text, labelStyle(TEXT_FONT, CSS.inkHi)))
      .setOrigin(0.5, 1)
      .setDepth(40_001)
      .setScale(1 / zoom);
  }

  private hideTip() {
    this.tip?.destroy();
    this.tip = undefined;
  }

  private clear() {
    this.hideTip();
    for (const p of this.placed) p.img.destroy(), p.lights?.destroy();
    this.placed = [];
  }

  destroy() {
    this.clear();
    this.key = '';
  }
}
