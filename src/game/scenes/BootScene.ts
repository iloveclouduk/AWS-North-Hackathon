import Phaser from 'phaser';
import { preloadKenney } from '../assets';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    preloadKenney(this);
  }

  create() {
    this.scene.start('city');
  }
}
