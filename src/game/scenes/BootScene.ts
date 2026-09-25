import Phaser from 'phaser';
import { createCharacterAnims, preloadIndexes, queueAssets } from '../assets';
import { PIXEL_FONT } from '../SpeechBubble';

/** Loads indexes, then every atlas/sheet/sound they list, then the pixel font, then starts the city. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    preloadIndexes(this);
  }

  create() {
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 100, height / 2, 0, 8, 0xff9900).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2, 204, 12).setStrokeStyle(2, 0xffffff);
    this.add.text(width / 2, height / 2 - 24, 'Building AWS City…', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    this.load.on('progress', (v: number) => bar.setSize(200 * v, 8));
    queueAssets(this);
    this.load.once('complete', async () => {
      createCharacterAnims(this);
      await Promise.race([document.fonts.load(`16px ${PIXEL_FONT}`), new Promise((r) => setTimeout(r, 1500))]);
      this.scene.start('city');
    });
    this.load.start();
  }
}
