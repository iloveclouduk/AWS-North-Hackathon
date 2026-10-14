import Phaser from 'phaser';
import { useCity } from '@/state/store';
import type { GameId } from '@/world/places';
import { sfx } from '../../audio';
import { keysBelongToUi } from '../../keys';
import { reducedMotion } from '../../motion';
import { EXPERT_STARS, expert, expertOpen, relaxed, setExpert } from '../../pace';

export { pace } from '../../pace';
import { crisp, TEXT_FONT } from '../../SpeechBubble';
import { syncClock } from './clock';
import { comboMultiplier, comboStepUp } from './combo';
import { countRound, roundStars } from '@/learning/gameStars';
import { growthLine, growthOf } from '@/state/growth';
import { onSceneEnd } from '../lifecycle';

export const TXT = (size = 16, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({ fontFamily: TEXT_FONT, fontSize: `${Math.round(size * 0.85)}px`, fontStyle: '800', color });

/** The panel palette (src/app/app.css tokens), so every game wears the same chrome as the UI. */
export const PAL = {
  bg: 0x140d1f,
  panel: 0x241a37,
  line: 0x4a3768,
  black: 0x000000,
  accent: 0xffb84d,
  accentInk: '#4a2e07',
  paper: 0xfffbeb,
  paperInk: '#1b1200',
  good: '#6fe3a3',
  bad: '#ff8a8a',
  muted: '#b6a7d9',
} as const;

const BAR_H = 34;

/**
 * Shared chrome for mini-games: a title bar with score and timer chips, a hint strip, a draining timer
 * bar, pixel buttons, and a paper end screen with the lesson, XP and best score.
 * Subclasses pass "Title — how to play" as the title.
 */
export abstract class MiniGame extends Phaser.Scene {
  protected score = 0;
  protected timeLeft = 0;
  protected over = false;
  private scoreText!: Phaser.GameObjects.Text;
  private timeText?: Phaser.GameObjects.Text;
  private timeBar?: Phaser.GameObjects.Rectangle;
  private timerEvt?: Phaser.Time.TimerEvent;

  constructor(
    key: string,
    protected gameId: GameId,
    protected serviceId: string,
    protected title: string,
  ) {
    super(key);
  }

  protected abstract setup(): void;
  protected abstract lesson(): string;
  /** Seconds per round; 0 = no timer (round ends itself). */
  protected duration = 45;
  /** The clock is the game itself (Rush Hour's day): relaxed play slows it down instead of removing it. */
  protected clockIsTheGame = false;
  /** One game second, in ms: two real seconds in relaxed play when the clock is the game. */
  protected get tickMs() {
    return relaxed() && this.clockIsTheGame ? 2000 : 1000;
  }
  /** Relaxed play without a round clock: the player ends the round with Done. */
  private get untimed() {
    return relaxed() && !this.clockIsTheGame;
  }
  /** Top of the play area (below the title bar and hint strip). */
  protected get top() {
    return BAR_H + 24;
  }

  create() {
    syncClock(this);
    this.score = 0;
    this.over = false;
    this.streak = 0;
    this.endCentre = undefined;
    this.endShade = undefined;
    this.timeLeft = this.duration;
    this.cameras.main.setBackgroundColor('#140d1f').setRoundPixels(true);
    this.setup();
    this.chrome();
    if (this.duration && !this.untimed) this.timerEvt = this.time.addEvent({ delay: this.tickMs, loop: true, callback: () => --this.timeLeft <= 0 && this.finish() });
    this.scale.on('resize', this.onResize, this);
    onSceneEnd(this, () => this.scale.off('resize', this.onResize, this));
  }

  private chrome() {
    const { width: w } = this.scale;
    const [name, how] = this.title.split(' — ');
    this.add.rectangle(0, 0, w, BAR_H, PAL.bg, 0.94).setOrigin(0).setDepth(100);
    this.add.rectangle(0, BAR_H, w, 2, PAL.black).setOrigin(0).setDepth(100);
    const titled = crisp(this.add.text(12, BAR_H / 2, name, TXT(17, '#ffb84d'))).setOrigin(0, 0.5).setDepth(101);
    if (expert()) crisp(this.add.text(titled.x + titled.width + 8, BAR_H / 2, '⚡ Expert', { ...TXT(14, PAL.accentInk), backgroundColor: '#ffb84d', padding: { x: 6, y: 2 } })).setOrigin(0, 0.5).setDepth(101);
    if (how) {
      this.add.rectangle(0, BAR_H + 2, w, 22, PAL.panel, 0.88).setOrigin(0).setDepth(100);
      crisp(this.add.text(12, BAR_H + 13, how.charAt(0).toUpperCase() + how.slice(1), TXT(14, PAL.muted))).setOrigin(0, 0.5).setDepth(101);
    }
    this.scoreText = this.chip(w - 12, '★ 0');
    if (this.duration && this.untimed) {
      const t = crisp(this.add.text(0, 0, '✓ Done', TXT(15, PAL.accentInk))).setOrigin(0.5);
      const right = this.scoreText.x - this.scoreText.width - 8;
      const bw = t.width + 16;
      const bg = this.add.rectangle(0, 0, bw, 22, PAL.accent).setStrokeStyle(2, PAL.black);
      this.add
        .container(right - bw / 2, BAR_H / 2, [bg, t])
        .setSize(bw, 22)
        .setDepth(101)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => (sfx('click'), this.finish()));
      this.input.keyboard?.on('keydown-ENTER', () => !keysBelongToUi(document.activeElement, this.game.canvas) && this.finish());
    } else if (this.duration) {
      this.timeText = this.chip(this.scoreText.x - this.scoreText.width - 8, `⏱ ${this.duration}`);
      this.timeBar = this.add.rectangle(0, BAR_H, w, 2, PAL.accent).setOrigin(0).setDepth(102);
    }
  }

  /** A right-aligned stat chip in the title bar. */
  private chip(right: number, text: string) {
    return crisp(this.add.text(right, BAR_H / 2, text, { ...TXT(16, '#ffffff'), backgroundColor: '#2d2144', padding: { x: 8, y: 3 } }))
      .setOrigin(1, 0.5)
      .setDepth(101);
  }

  /** A chunky pixel button (hard shadow, sinks when pressed). */
  protected pxButton(x: number, y: number, label: string, fn: () => void, fill: number = PAL.accent, ink: string = PAL.accentInk) {
    const t = crisp(this.add.text(0, 0, label, TXT(16, ink))).setOrigin(0.5);
    const bw = Math.max(64, t.width + 22);
    const bh = t.height + 12;
    const shadow = this.add.rectangle(0, 3, bw, bh, PAL.black);
    const face = this.add.rectangle(0, 0, bw, bh, fill).setStrokeStyle(2, PAL.black);
    const c = this.add.container(x, y, [shadow, face, t]).setSize(bw, bh + 3).setDepth(150);
    c.setInteractive({ useHandCursor: true })
      .on('pointerover', () => face.setAlpha(0.88))
      .on('pointerout', () => (face.setAlpha(1), face.setY(0), t.setY(0)))
      .on('pointerdown', () => {
        face.setY(3);
        t.setY(3);
        fn();
        sfx('click'); // after fn: skipped when the press already made its own sound
      })
      .on('pointerup', () => (face.setY(0), t.setY(0)));
    return c;
  }

  /** Keyboard play: `fn(key)` on each key press during the round, unless a UI control has focus (see keys.ts). */
  protected onKeys(fn: (key: string) => void) {
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (this.over || e.repeat || keysBelongToUi(document.activeElement, this.game.canvas)) return;
      fn(e.key);
    });
  }

  /**
   * Re-lay out by restarting, but never mid-round (a panel resize must not wipe the score and timer), and never once
   * the round is over: the end card (everything at depth 200 and up) moves to the new centre and keeps the result.
   */
  private onResize() {
    if (this.over) return this.recentreEndCard();
    const live = this.score !== 0 || this.timeLeft < this.duration;
    if (!live) this.scene.restart();
  }

  /** Where the end card was centred (finish), so a resize can move it by the difference. */
  private endCentre?: { x: number; y: number };

  private recentreEndCard() {
    if (!this.endCentre) return;
    const { width: w, height: h } = this.scale;
    const dx = Math.round(w / 2 - this.endCentre.x);
    const dy = Math.round(h / 2 - this.endCentre.y);
    this.endCentre = { x: this.endCentre.x + dx, y: this.endCentre.y + dy };
    for (const o of this.children.list as (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth & Phaser.GameObjects.Components.Transform)[]) {
      if (o.depth < 200) continue;
      // The dim backdrop covers the whole view: resize it rather than move it.
      if (o === this.endShade) this.endShade.setSize(w, h);
      else o.setPosition(o.x + dx, o.y + dy);
    }
  }

  private endShade?: Phaser.GameObjects.Rectangle;

  override update(_t: number, _dt: number) {
    this.scoreText?.setText(`★ ${this.score}`);
    if (this.timeText) {
      const left = Math.max(0, this.timeLeft);
      this.timeText.setText(`⏱ ${left}`).setColor(left <= 10 ? PAL.bad : '#ffffff');
      this.timeBar?.setSize(this.scale.width * (left / this.duration), 2).setFillStyle(left <= 10 ? 0xff6b6b : PAL.accent);
    }
  }

  /**
   * `cue`: 'player' for the player's own press (full feedback), 'soft' for an outcome a timer decided
   * (quieter), 'none' for routine timer ticks. A 0 change makes no sound; call `miss()` for a wrong answer.
   */
  protected addScore(n: number, cue: 'player' | 'soft' | 'none' = 'player') {
    // The player's own right answers build a combo (src/game/scenes/games/combo.ts); any mistake ends it.
    if (cue === 'player' && n > 0) {
      this.streak++;
      n *= comboMultiplier(this.streak);
      this.sparks();
      if (comboStepUp(this.streak)) this.comboFloat();
    } else if (n < 0) this.breakStreak(cue === 'player');
    this.score = Math.max(0, this.score + n);
    if (n === 0 || cue === 'none') return;
    sfx(n > 0 ? 'correct' : 'wrong', cue === 'soft' ? { soft: true } : { own: true });
  }

  /** The player's answer was wrong but costs nothing (it still ends the combo). */
  protected miss() {
    this.breakStreak(true);
    sfx('wrong', { own: true });
  }

  /** Right answers in a row (the combo). */
  protected streak = 0;

  private breakStreak(shake: boolean) {
    this.streak = 0;
    if (shake && !reducedMotion()) this.cameras.main.shake(110, 0.0035);
  }

  /** "×2!" by the score chip when the combo steps up. */
  private comboFloat() {
    const x = (this.scoreText?.x ?? this.scale.width - 40) - (this.scoreText?.width ?? 40) / 2;
    this.floater(x, BAR_H + 34, `×${comboMultiplier(this.streak)} combo!`, '#ffd166');
  }

  /** A little burst of sparks where the player pressed (no textures: a few pixel squares, no tweens under reduced motion). */
  private sparks() {
    if (reducedMotion()) return;
    const p = this.input.activePointer;
    const x = p.x || this.scale.width / 2;
    const y = p.y || this.scale.height / 2;
    const colors = [0xffd166, 0x6fe3a3, 0xffb84d, 0xffffff];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
      const d = 18 + Math.random() * 14;
      const sq = this.add.rectangle(x, y, 3, 3, colors[i % colors.length]).setDepth(95);
      this.tweens.add({ targets: sq, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, duration: 420, ease: 'Quad.easeOut', onComplete: () => sq.destroy() });
    }
  }

  protected floater(x: number, y: number, text: string, color: string) {
    const t = crisp(this.add.text(x, y, text, { ...TXT(16, color), stroke: '#140d1f', strokeThickness: 4 })).setOrigin(0.5).setDepth(90);
    if (reducedMotion()) return void this.time.delayedCall(900, () => t.destroy());
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 900, ease: 'Stepped', easeParams: [6], onComplete: () => t.destroy() });
  }

  protected finish() {
    if (this.over) return;
    this.over = true;
    this.timerEvt?.remove();
    const s = useCity.getState();
    const best = s.progress.games?.[this.gameId]?.best ?? 0;
    // Full stars for a new best or the first rounds of the day; half after that (src/learning/gameStars.ts).
    const xp = roundStars(Math.min(expert() ? 38 : 25, Math.round((this.score / 10) * (expert() ? EXPERT_STARS : 1))), countRound(this.gameId), this.score > best);
    s.recordGame(this.gameId, this.score);
    if (xp > 0) s.addXp(this.serviceId, xp);
    // a round played counts toward Today and the streak (src/state/progress.ts)
    if (this.score > 0) s.noteLearning('games');
    const newBest = this.score > best;
    const { width: w, height: h } = this.scale;
    this.endShade = this.add.rectangle(0, 0, w, h, PAL.bg, 0.72).setOrigin(0).setDepth(200);
    // A paper card, like the flashcards: hard black border and shadow.
    const cw = Math.min(440, w - 24);
    const ch = 290;
    const cx = w / 2;
    const cy = h / 2;
    this.endCentre = { x: cx, y: cy };
    this.add.rectangle(cx, cy + 5, cw, ch, PAL.black).setDepth(201);
    const card = this.add.rectangle(cx, cy, cw, ch, PAL.paper).setStrokeStyle(3, PAL.black).setDepth(201);
    const top = card.y - ch / 2;
    crisp(this.add.text(cx, top + 18, newBest && this.score > 0 ? '🏆 New best!' : 'Round over', TXT(18, '#92400e'))).setOrigin(0.5, 0).setDepth(202);
    crisp(this.add.text(cx, top + 44, `Score ${this.score}   ·   +${xp} ⭐   ·   best ${Math.max(best, this.score)}`, TXT(16, PAL.paperInk))).setOrigin(0.5, 0).setDepth(202);
    // The building this game grows, and how far (src/state/growth.ts): the reason to play another round.
    const g = growthOf(useCity.getState().progress, this.serviceId, useCity.getState().cityRegion);
    crisp(this.add.text(cx, top + 70, `🏗️ ${growthLine(g)}`, TXT(14, '#374151'))).setOrigin(0.5, 0).setDepth(202);
    const barW = Math.min(260, cw - 60);
    this.add.rectangle(cx, top + 96, barW, 8, 0x000000, 0.15).setDepth(202);
    this.add.rectangle(cx - barW / 2, top + 96, Math.max(4, barW * g.pct), 8, 0x16a34a).setOrigin(0, 0.5).setDepth(202);
    this.add.rectangle(cx, top + 112, cw - 40, 2, 0x000000, 0.12).setDepth(202);
    crisp(
      this.add.text(cx, top + 122, this.lesson(), { ...TXT(14, '#374151'), fontStyle: '600', align: 'center', wordWrap: { width: cw - 40 }, lineSpacing: 2 }).setOrigin(0.5, 0).setDepth(202),
    );
    const leave = () => (setExpert(false), useCity.getState().setView({ name: 'city' }));
    // The Expert round opens at building level 3: quicker, harder cards, half as many stars again.
    if (expertOpen(this.serviceId)) {
      this.pxButton(cx - 118, top + ch - 30, '↻ Again', () => (setExpert(false), this.scene.restart())).setDepth(203);
      this.pxButton(cx, top + ch - 30, '⚡ Expert', () => (setExpert(true), this.scene.restart()), 0xf472b6, PAL.paperInk).setDepth(203);
      this.pxButton(cx + 118, top + ch - 30, '← City', leave, 0x2d2144, '#ffffff').setDepth(203);
    } else {
      this.pxButton(cx - 74, top + ch - 30, '↻ Play again', () => (setExpert(false), this.scene.restart())).setDepth(203);
      this.pxButton(cx + 74, top + ch - 30, '← City', leave, 0x2d2144, '#ffffff').setDepth(203);
    }
    // A new best gets the fanfare; an ordinary round ends on a plain ding (the quest jingle means a finished quest).
    sfx(newBest ? 'levelup' : 'correct', { own: true });
  }
}
