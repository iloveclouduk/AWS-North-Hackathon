import Phaser from 'phaser';
import type { Tile } from '@/world/layout';
import { entityDepth, toScreen, type Iso } from './iso';
import { findPath } from './pathfinding';

/** Glowing data packets that travel the road network when agents talk — the architecture, visible. */
export class Packets {
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

  send(from: Tile, to: Tile, color: number) {
    const path = findPath(from, to, this.grid, this.grid, this.travel);
    if (!path.length) return;
    const pts = [from, ...path].map((t) => toScreen(this.iso, t.x, t.y));
    const p = this.scene.add.image(pts[0].x, pts[0].y - 6, 'packet').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(entityDepth(pts[0].y) + 2);
    const trail = this.scene.add.image(pts[0].x, pts[0].y - 6, 'packet').setTint(color).setAlpha(0.4).setScale(1.8).setBlendMode(Phaser.BlendModes.ADD).setDepth(p.depth - 1);
    let i = 0;
    const hop = () => {
      i++;
      if (i >= pts.length) {
        this.scene.tweens.add({ targets: [p, trail], alpha: 0, scale: 3, duration: 250, onComplete: () => (p.destroy(), trail.destroy()) });
        return;
      }
      const q = pts[i];
      this.scene.tweens.add({ targets: p, x: q.x, y: q.y - 6, duration: 70, onUpdate: () => p.setDepth(entityDepth(p.y) + 2), onComplete: hop });
      this.scene.tweens.add({ targets: trail, x: q.x, y: q.y - 6, duration: 110 });
    };
    hop();
  }
}
