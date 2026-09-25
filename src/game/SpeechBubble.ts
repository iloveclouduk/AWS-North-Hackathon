import Phaser from 'phaser';

/** Nunito (OFL, bundled in public/assets/fonts) — the prototype's UI font; crisp and readable. */
export const TEXT_FONT = 'Nunito, "Trebuchet MS", sans-serif';
export const PIXEL_FONT = '"Press Start 2P", monospace';
export const UI_FONT = TEXT_FONT;

export interface SayOptions {
  /** How long to keep it up after typing finishes. Defaults scale with length. */
  holdMs?: number;
  /** Small line above the text, e.g. "Step 2/5" (shown after the speaker's name). */
  caption?: string;
  tone?: 'speech' | 'step' | 'done' | 'alert';
  typewriter?: boolean;
}

const TONES = {
  speech: { fill: 0xffffff, stroke: 0x161622, text: '#161622', name: '#b45309' },
  step: { fill: 0xfff4d6, stroke: 0x161622, text: '#161622', name: '#b45309' },
  done: { fill: 0xe7fbe9, stroke: 0x14532d, text: '#14532d', name: '#15803d' },
  alert: { fill: 0xffe4e4, stroke: 0x7f1d1d, text: '#7f1d1d', name: '#b91c1c' },
};

/**
 * Crisp text in a pixel-art world: Phaser's pixelArt mode samples every texture with NEAREST, which
 * makes text jaggy when zoomed. Text textures switch to LINEAR and render at devicePixelRatio, and the
 * owner counter-scales by 1/zoom so bubbles stay the same readable size at every zoom level.
 */
export function crisp<T extends Phaser.GameObjects.Text>(t: T): T {
  t.setResolution(Math.max(2, window.devicePixelRatio || 1));
  t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return t;
}

/** Habbo-style speech bubble: speaker name, message, little tail; types its text out. */
export class SpeechBubble extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private cap: Phaser.GameObjects.Text;
  private typer?: Phaser.Time.TimerEvent;
  private hideTimer?: Phaser.Time.TimerEvent;
  private maxW: number;
  boxH = 0;

  constructor(scene: Phaser.Scene, maxW = 220) {
    super(scene, 0, 0);
    this.maxW = maxW;
    this.bg = scene.add.graphics();
    this.cap = crisp(scene.add.text(0, 0, '', { fontFamily: TEXT_FONT, fontSize: '12px', fontStyle: '800', color: '#b45309' }));
    this.label = crisp(
      scene.add.text(0, 0, '', {
        fontFamily: TEXT_FONT,
        fontSize: '13px',
        fontStyle: '700',
        color: '#161622',
        wordWrap: { width: maxW - 16, useAdvancedWrap: true },
        lineSpacing: 1,
      }),
    );
    this.add([this.bg, this.cap, this.label]);
    this.setVisible(false);
    scene.add.existing(this);
  }

  get showing() {
    return this.visible && this.alpha > 0.05;
  }

  say(text: string, speaker: string | undefined, opts: SayOptions = {}) {
    const tone = TONES[opts.tone ?? 'speech'];
    this.typer?.remove();
    this.hideTimer?.remove();
    this.scene.tweens.killTweensOf(this);
    this.setVisible(true).setAlpha(1);
    this.label.setColor(tone.text);
    const header = [speaker, opts.caption].filter(Boolean).join(' · ');
    this.cap.setColor(tone.name).setText(header);
    this.label.setText(text);
    this.layout(tone);
    const typewriter = opts.typewriter ?? true;
    if (typewriter && text.length > 1) {
      let n = 0;
      this.label.setText('');
      this.typer = this.scene.time.addEvent({ delay: 16, repeat: text.length - 1, callback: () => this.label.setText(text.slice(0, ++n)) });
    }
    const hold = opts.holdMs ?? 3000 + text.length * 50;
    this.hideTimer = this.scene.time.delayedCall((typewriter ? text.length * 16 : 0) + hold, () => this.hide());
  }

  hide(fast = false) {
    this.hideTimer?.remove();
    this.scene.tweens.add({ targets: this, alpha: 0, duration: fast ? 150 : 300, onComplete: () => this.setVisible(false) });
  }

  private layout(tone: (typeof TONES)[keyof typeof TONES]) {
    const padX = 8;
    const padY = 5;
    const capH = this.cap.text ? this.cap.height - 1 : 0;
    const w = Math.min(this.maxW, Math.max(this.label.width, this.cap.width) + padX * 2);
    const h = this.label.height + capH + padY * 2;
    this.boxH = h + 8;
    const x = Math.round(-w / 2);
    const y = Math.round(-h - 7);
    this.bg.clear();
    this.bg.fillStyle(0x000000, 0.25).fillRoundedRect(x + 1, y + 2, w, h, 5);
    this.bg.fillStyle(tone.fill, 1).fillRoundedRect(x, y, w, h, 5);
    this.bg.lineStyle(2, tone.stroke, 1).strokeRoundedRect(x, y, w, h, 5);
    this.bg.fillStyle(tone.fill, 1).fillTriangle(-5, y + h - 1, 5, y + h - 1, 0, y + h + 6);
    this.bg.lineStyle(2, tone.stroke, 1).lineBetween(-5, y + h, 0, y + h + 6).lineBetween(5, y + h, 0, y + h + 6);
    this.cap.setPosition(x + padX, y + padY - 1);
    this.label.setPosition(x + padX, y + padY + capH);
  }
}
