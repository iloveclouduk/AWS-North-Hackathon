import Phaser from 'phaser';

/**
 * Day/night from the player's local clock: a multiply-tinted overlay over the world plus a
 * 0..1 "night" factor that landmarks and lamps use to switch their lights on.
 */
export class DayNight {
  private overlay: Phaser.GameObjects.Rectangle;
  /** Override for demos/tests: hour 0–24, or undefined for the real clock. */
  forcedHour?: number;
  night = 0;

  constructor(private scene: Phaser.Scene) {
    this.overlay = scene.add
      .rectangle(0, 0, 10, 10, 0x1a2350, 0)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(70_000)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
  }

  /** Night factor for an hour: 0 from 8:00–17:00, ramps through dusk/dawn, 1 from 21:00–5:00. */
  static nightFor(hour: number) {
    if (hour >= 8 && hour <= 17) return 0;
    if (hour >= 21 || hour <= 5) return 1;
    if (hour > 17) return (hour - 17) / 4;
    return (8 - hour) / 3;
  }

  update() {
    const d = new Date();
    const hour = this.forcedHour ?? d.getHours() + d.getMinutes() / 60;
    this.night = DayNight.nightFor(hour);
    const cam = this.scene.cameras.main;
    // Overlay covers the viewport; scale compensates for camera zoom (scrollFactor 0 still zooms).
    this.overlay.setSize(cam.width / cam.zoom + 4, cam.height / cam.zoom + 4);
    this.overlay.setPosition(cam.width / 2 - cam.width / cam.zoom / 2 - 2, cam.height / 2 - cam.height / cam.zoom / 2 - 2);
    const dusk = hour > 12 ? 0xff9a6a : 0xffc9a0;
    const color = this.night > 0.6 ? 0x2a3470 : Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(dusk),
      Phaser.Display.Color.ValueToColor(0x2a3470),
      100,
      Math.round(this.night * 100),
    );
    const c = typeof color === 'number' ? color : Phaser.Display.Color.GetColor(color.r, color.g, color.b);
    this.overlay.setFillStyle(c, Math.min(0.62, this.night * 0.7));
  }
}
