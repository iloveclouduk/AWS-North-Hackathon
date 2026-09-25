import Phaser from 'phaser';
import { useCity } from '@/state/store';
import type { GameId } from '@/world/places';
import { sfx } from '../../audio';
import { TEXT_FONT } from '../../SpeechBubble';

export const TXT = (size = 16, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({ fontFamily: TEXT_FONT, fontSize: `${Math.round(size * 0.85)}px`, fontStyle: '800', color });

/** Shared chrome for mini-games: title, HUD, timer, end screen with the lesson, XP + best score. */
export abstract class MiniGame extends Phaser.Scene {
  protected score = 0;
  protected timeLeft = 0;
  protected over = false;
  private hud!: Phaser.GameObjects.Text;
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

  create() {
    this.score = 0;
    this.over = false;
    this.timeLeft = this.duration;
    this.cameras.main.setBackgroundColor('#140d1f').setRoundPixels(true);
    this.setup();
    this.add.text(10, 8, this.title, TXT(16, '#fde047')).setDepth(100);
    this.hud = this.add.text(this.scale.width - 10, 8, '', TXT(16)).setOrigin(1, 0).setDepth(100);
    if (this.duration) this.timerEvt = this.time.addEvent({ delay: 1000, loop: true, callback: () => --this.timeLeft <= 0 && this.finish() });
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.onResize, this));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.scale.off('resize', this.onResize, this));
  }

  private onResize() {
    this.scene.restart();
  }

  override update(_t: number, _dt: number) {
    this.hud?.setText(`Score ${this.score}${this.duration ? ` · ${Math.max(0, this.timeLeft)}s` : ''}`);
  }

  protected addScore(n: number) {
    this.score = Math.max(0, this.score + n);
    sfx(n > 0 ? 'correct' : 'wrong', 0.3);
  }

  protected floater(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y, text, TXT(16, color)).setOrigin(0.5).setDepth(90);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  protected finish() {
    if (this.over) return;
    this.over = true;
    this.timerEvt?.remove();
    const xp = Math.min(25, Math.round(this.score / 10));
    const s = useCity.getState();
    s.recordGame(this.gameId, this.score);
    if (xp > 0) s.addXp(this.serviceId, xp);
    const { width: w, height: h } = this.scale;
    this.add.rectangle(0, 0, w, h, 0x000000, 0.65).setOrigin(0).setDepth(200);
    const box = this.add.rectangle(w / 2, h / 2, Math.min(440, w - 20), 230, 0xffffff).setStrokeStyle(2, 0x161622).setDepth(201);
    this.add.text(w / 2, box.y - 100, `🏆 Score ${this.score}  (+${xp} XP)`, TXT(16, '#161622')).setOrigin(0.5, 0).setDepth(202);
    this.add
      .text(w / 2, box.y - 74, this.lesson(), { ...TXT(16, '#374151'), align: 'center', wordWrap: { width: Math.min(410, w - 40) }, lineSpacing: -4 })
      .setOrigin(0.5, 0)
      .setDepth(202);
    const btn = (x: number, label: string, fn: () => void) =>
      this.add.text(x, box.y + 80, label, { ...TXT(16, '#ffffff'), backgroundColor: '#e68a00', padding: { x: 10, y: 4 } }).setOrigin(0.5).setDepth(202).setInteractive({ useHandCursor: true }).on('pointerdown', fn);
    btn(w / 2 - 70, '↻ Play again', () => this.scene.restart());
    btn(w / 2 + 70, '← City', () => useCity.getState().setView({ name: 'city' }));
    sfx('levelup', 0.4);
  }
}
