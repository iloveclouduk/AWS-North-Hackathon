import Phaser from 'phaser';

export const UI_FONT = '"Trebuchet MS", Verdana, sans-serif';

export interface SayOptions {
  /** How long to keep it up after typing finishes. Defaults scale with length. */
  holdMs?: number;
  /** Small caption above the text, e.g. "Step 2/5". */
  caption?: string;
  tone?: 'speech' | 'step' | 'done' | 'alert';
  typewriter?: boolean;
}

const TONES = {
  speech: { fill: 0xffffff, stroke: 0x161622, text: '#161622', caption: '#6b7280' },
  step: { fill: 0xfef9c3, stroke: 0x161622, text: '#161622', caption: '#a16207' },
  done: { fill: 0xdcfce7, stroke: 0x14532d, text: '#14532d', caption: '#15803d' },
  alert: { fill: 0xfee2e2, stroke: 0x7f1d1d, text: '#7f1d1d', caption: '#b91c1c' },
};

/** Habbo-style speech bubble that floats above an agent and types its text out. */
export class SpeechBubble extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private cap: Phaser.GameObjects.Text;
  private typer?: Phaser.Time.TimerEvent;
  private hideTimer?: Phaser.Time.TimerEvent;
  private maxW: number;

  constructor(scene: Phaser.Scene, maxW = 190) {
    super(scene, 0, 0);
    this.maxW = maxW;
    this.bg = scene.add.graphics();
    this.cap = scene.add.text(0, 0, '', { fontFamily: UI_FONT, fontSize: '10px', fontStyle: 'bold', color: '#6b7280', resolution: 2 });
    this.label = scene.add.text(0, 0, '', {
      fontFamily: UI_FONT,
      fontSize: '12px',
      color: '#161622',
      wordWrap: { width: maxW - 16, useAdvancedWrap: true },
      resolution: 2,
      lineSpacing: 1,
    });
    this.add([this.bg, this.cap, this.label]);
    this.setVisible(false);
    scene.add.existing(this);
  }

  say(text: string, opts: SayOptions = {}) {
    const tone = TONES[opts.tone ?? 'speech'];
    this.typer?.remove();
    this.hideTimer?.remove();
    this.setVisible(true).setAlpha(1);
    this.label.setColor(tone.text);
    this.cap.setColor(tone.caption).setText(opts.caption ?? '');

    // Lay out with the full text first so the bubble doesn't resize while typing.
    this.label.setText(text);
    this.layout(tone);
    const typewriter = opts.typewriter ?? true;
    if (typewriter && text.length > 1) {
      let n = 0;
      this.label.setText('');
      this.typer = this.scene.time.addEvent({
        delay: 22,
        repeat: text.length - 1,
        callback: () => this.label.setText(text.slice(0, ++n)),
      });
    }
    const hold = opts.holdMs ?? 2500 + text.length * 45;
    this.hideTimer = this.scene.time.delayedCall((typewriter ? text.length * 22 : 0) + hold, () => this.hide());
  }

  hide() {
    this.hideTimer?.remove();
    this.scene.tweens.add({ targets: this, alpha: 0, duration: 250, onComplete: () => this.setVisible(false) });
  }

  private layout(tone: (typeof TONES)[keyof typeof TONES]) {
    const padX = 8;
    const padY = 6;
    const capH = this.cap.text ? this.cap.height : 0;
    const w = Math.min(this.maxW, Math.max(this.label.width, this.cap.width) + padX * 2);
    const h = this.label.height + capH + padY * 2;
    // Bubble sits above (0,0) with a tail pointing down to it.
    const x = -w / 2;
    const y = -h - 8;
    this.bg.clear();
    this.bg.fillStyle(0x000000, 0.18).fillRoundedRect(x + 2, y + 3, w, h, 6);
    this.bg.fillStyle(tone.fill, 1).lineStyle(2, tone.stroke, 1);
    this.bg.fillRoundedRect(x, y, w, h, 6).strokeRoundedRect(x, y, w, h, 6);
    this.bg.fillTriangle(-6, y + h - 1, 6, y + h - 1, 0, y + h + 7);
    this.bg.lineBetween(-6, y + h, 0, y + h + 7).lineBetween(6, y + h, 0, y + h + 7);
    this.cap.setPosition(x + padX, y + padY);
    this.label.setPosition(x + padX, y + padY + capH);
  }
}
