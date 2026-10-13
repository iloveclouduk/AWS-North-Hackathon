import Phaser from 'phaser';
import { reducedMotion } from './motion';
import type { BubblePriority } from './calm';
import { BUBBLE_TONES, FONT_SIZE } from './theme';

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
  /** Who gets the floor (src/game/calm.ts mayShowBubble). Defaults to 'normal'. */
  priority?: BubblePriority;
  /** Show the line without the speaker's blip (agents talking among themselves: the player didn't ask). */
  silent?: boolean;
}

/** The UI's bubble tones (src/game/theme.ts mirrors src/app/styles/00-base.css). */
const TONES = BUBBLE_TONES;

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
  boxW = 0;

  constructor(scene: Phaser.Scene, maxW = 220) {
    super(scene, 0, 0);
    this.maxW = maxW;
    this.bg = scene.add.graphics();
    this.cap = crisp(scene.add.text(0, 0, '', { fontFamily: TEXT_FONT, fontSize: FONT_SIZE.sm, fontStyle: '800', color: BUBBLE_TONES.speech.name }));
    this.label = crisp(
      scene.add.text(0, 0, '', {
        fontFamily: TEXT_FONT,
        fontSize: FONT_SIZE.md,
        fontStyle: '700',
        color: BUBBLE_TONES.speech.text,
        wordWrap: { width: maxW - 16, useAdvancedWrap: true },
        lineSpacing: 1,
      }),
    );
    this.add([this.bg, this.cap, this.label]);
    this.setVisible(false);
    scene.add.existing(this);
  }

  override destroy(fromScene?: boolean) {
    this.typer?.remove();
    this.hideTimer?.remove();
    super.destroy(fromScene);
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
    const typewriter = opts.typewriter ?? !reducedMotion();
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
    // Already destroyed (its agent moved out, or the scene shut down): nothing to fade.
    if (!this.scene) return;
    this.scene.tweens.add({ targets: this, alpha: 0, duration: fast ? 150 : 300, onComplete: () => this.setVisible(false) });
  }

  private layout(tone: (typeof TONES)[keyof typeof TONES]) {
    const padX = 8;
    const padY = 5;
    const capH = this.cap.text ? this.cap.height - 1 : 0;
    const w = Math.min(this.maxW, Math.max(this.label.width, this.cap.width) + padX * 2);
    const h = this.label.height + capH + padY * 2;
    this.boxH = h + 8;
    this.boxW = w;
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
