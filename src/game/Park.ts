// re:Play Park in the city (src/world/park.ts lays it out): six rides on the terrain's park site, each open once its
// service's building reaches Practitioner here, else under wraps. Open rides turn (three frames, still under reduced
// motion) and light up at night. Tapping an open ride rides it (Kai walks over, it spins fast, he hops off with a tip);
// tapping a closed one opens its building's card; hovering a closed one says what opens it.
import Phaser from 'phaser';
import type { Progress } from '@/backend/contract';
import { parkLayout, rideAction, rideHint, RIDE_MS, type ParkPiece, type Ride } from '@/world/park';
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

  /** Rides being ridden now, until (scene ms): they turn three times as fast. */
  private riding = new Map<string, number>();

  constructor(
    private scene: Phaser.Scene,
    /** Kai rides: the scene walks him to `piece` and calls `start` when he's on. */
    private onRide?: (ride: Ride, piece: ParkPiece, start: () => void) => void,
  ) {}

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
        img.on('pointerup', (ptr: Phaser.Input.Pointer) => {
          if (ptr.getDistance() >= 8) return; // a drag pans the camera
          click();
          if (rideAction(piece) === 'ride' && this.onRide) return this.onRide(ride, piece, () => this.spin(ride.id, img));
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

  /** A ride with Kai on it: frames turn fast for RIDE_MS; a ride without frames rocks instead. */
  private spin(id: string, img: Phaser.GameObjects.Image) {
    if (reducedMotion()) return;
    this.riding.set(id, this.scene.time.now + RIDE_MS);
    const ride = this.placed.find((p) => p.piece.ride?.id === id)?.piece.ride;
    if (!ride?.frames) this.scene.tweens.add({ targets: img, y: '-=3', yoyo: true, repeat: Math.round(RIDE_MS / 240), duration: 120, ease: 'Sine.easeInOut' });
  }

  /** Per frame: open rides turn (a ridden one three times as fast). */
  animate(time: number) {
    if (reducedMotion() || time - this.frameAt < FRAME_MS / 3) return;
    this.frameAt = time;
    this.frame = (this.frame + 1) % 9;
    for (const p of this.placed) {
      const r = p.piece.ride;
      if (!r || !p.piece.open || !r.frames) continue;
      const fast = (this.riding.get(r.id) ?? 0) > time;
      if (!fast && this.frame % 3) continue;
      const f = `park:${r.id}${fast ? this.frame % 3 : Math.floor(this.frame / 3)}`;
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
