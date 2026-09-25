import Phaser from 'phaser';
import { useCity } from '@/state/store';
import { castFor } from '../cast';
import { registerAgentSheet } from '../sprites';
import { UI_FONT } from '../SpeechBubble';

/**
 * S3 Lake mini-game: every fish is an object. Hook one, then drop it in the right storage-class
 * bucket based on how often it's accessed. Teaches Standard vs Standard-IA vs Glacier.
 */

type ClassId = 'standard' | 'ia' | 'glacier';
const CLASSES: { id: ClassId; label: string; color: number; note: string }[] = [
  { id: 'standard', label: 'S3 Standard', color: 0x3f9b4f, note: 'hot · read often' },
  { id: 'ia', label: 'Standard-IA', color: 0x3a6fd8, note: 'warm · monthly' },
  { id: 'glacier', label: 'Glacier', color: 0x7dd3fc, note: 'cold · archive' },
];

const FISH: { name: string; hint: string; answer: ClassId; why: string }[] = [
  { name: 'profile-pic.jpg', hint: 'Shown on every page load', answer: 'standard', why: 'Read constantly → S3 Standard: no retrieval fees, millisecond access.' },
  { name: 'app-bundle.js', hint: 'Downloaded by every visitor', answer: 'standard', why: 'Hot data → Standard (and put CloudFront in front of it!).' },
  { name: 'thumbnail-42.png', hint: 'Loaded thousands of times a day', answer: 'standard', why: 'Frequent reads make Standard cheapest overall.' },
  { name: 'invoice-2023.pdf', hint: 'Opened about once a month', answer: 'ia', why: 'Infrequent but must open instantly → Standard-IA: cheaper storage, small fee per read.' },
  { name: 'quarterly-report.xlsx', hint: 'Checked a few times per quarter', answer: 'ia', why: 'Warm data → Standard-IA saves ~40% vs Standard.' },
  { name: 'db-backup.sql.gz', hint: 'Restored only in emergencies, needs to be quick', answer: 'ia', why: 'Rare reads but fast restore → Standard-IA.' },
  { name: 'audit-logs-2019.zip', hint: 'Kept 7 years for compliance, never read', answer: 'glacier', why: 'Archive → Glacier. Waiting hours to restore is fine; storage is pennies.' },
  { name: 'tax-return-2015.pdf', hint: 'Must keep it, will never open it', answer: 'glacier', why: 'Cold archive → Glacier (Deep Archive is even cheaper).' },
  { name: 'raw-footage-2018.mov', hint: 'Old project, kept just in case', answer: 'glacier', why: 'Rarely if ever touched → Glacier. Use a lifecycle rule to move it automatically.' },
];

const ROUND = 5;
type State = 'ready' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'quiz' | 'summary';

export class FishingScene extends Phaser.Scene {
  private state: State = 'ready';
  private deck: typeof FISH = [];
  private caught = 0;
  private correct = 0;
  private waterY = 0;
  private bobber!: Phaser.GameObjects.Arc;
  private line!: Phaser.GameObjects.Graphics;
  private rodTip = new Phaser.Math.Vector2();
  private player!: Phaser.GameObjects.Sprite;
  private hud!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private swimmers: Phaser.GameObjects.Container[] = [];
  private card?: Phaser.GameObjects.Container;
  private biteTimer?: Phaser.Time.TimerEvent;
  private hooked?: Phaser.GameObjects.Container;

  constructor() {
    super('fishing');
  }

  create() {
    this.state = 'ready';
    this.caught = 0;
    this.correct = 0;
    this.swimmers = [];
    this.deck = Phaser.Utils.Array.Shuffle([...FISH]).slice(0, ROUND);
    this.build();
    this.scale.on('resize', this.relayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.relayout, this));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.scale.off('resize', this.relayout, this));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => !over.length && this.onClick(p));
  }

  private relayout() {
    this.scene.restart();
  }

  private build() {
    const { width: w, height: h } = this.scale;
    this.waterY = h * 0.45;
    const g = this.add.graphics();
    // sky + far hills
    g.fillGradientStyle(0x7dd3fc, 0x7dd3fc, 0xe0f2fe, 0xe0f2fe, 1).fillRect(0, 0, w, this.waterY);
    g.fillStyle(0x4caf50, 1).fillEllipse(w * 0.75, this.waterY + 10, w * 0.9, 90);
    g.fillStyle(0x3f9b4f, 1).fillEllipse(w * 0.2, this.waterY + 16, w * 0.7, 70);
    // water
    g.fillGradientStyle(0x3b82f6, 0x3b82f6, 0x1e3a8a, 0x1e3a8a, 1).fillRect(0, this.waterY, w, h - this.waterY);
    for (let i = 0; i < 14; i++) g.fillStyle(0xffffff, 0.15).fillRect(Math.random() * w, this.waterY + 10 + Math.random() * (h - this.waterY - 20), 30 + Math.random() * 40, 2);

    // pier
    const pierW = Math.min(260, w * 0.34);
    g.fillStyle(0x8b5a2b, 1).fillRect(0, this.waterY - 18, pierW, 18);
    g.fillStyle(0x6b4423, 1);
    for (let x = 12; x < pierW; x += 48) g.fillRect(x, this.waterY, 10, 60);

    // buckets on the pier
    CLASSES.forEach((c, i) => {
      const bx = 22 + i * ((pierW - 50) / 3);
      g.fillStyle(c.color, 1).fillRect(bx, this.waterY - 44, 30, 26);
      g.fillStyle(0x161622, 1).fillRect(bx - 2, this.waterY - 46, 34, 4);
      this.add.text(bx + 15, this.waterY - 50, c.label.replace('S3 ', ''), { fontFamily: UI_FONT, fontSize: '10px', fontStyle: 'bold', color: '#161622', resolution: 2 }).setOrigin(0.5, 1);
    });

    // player with a rod
    const cast = castFor('player')!;
    registerAgentSheet(this, 'player', cast.look);
    this.player = this.add.sprite(pierW - 40, this.waterY - 18, 'agent:player', 0).setOrigin(0.5, 28 / 30).setScale(1.6);
    this.player.play('player:work');
    this.rodTip.set(this.player.x + 26, this.player.y - 62);

    this.line = this.add.graphics().setDepth(5);
    this.bobber = this.add.circle(0, 0, 6, 0xef4444).setStrokeStyle(2, 0xffffff).setVisible(false).setDepth(6);

    for (let i = 0; i < 6; i++) this.spawnSwimmer(i);

    this.hud = this.add.text(w - 12, 10, '', { fontFamily: UI_FONT, fontSize: '14px', fontStyle: 'bold', color: '#0f172a', backgroundColor: '#ffffffcc', padding: { x: 8, y: 4 }, resolution: 2 }).setOrigin(1, 0).setDepth(20);
    this.info = this.add
      .text(w / 2, 40, '', { fontFamily: UI_FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff', stroke: '#0f172a', strokeThickness: 4, align: 'center', wordWrap: { width: w - 40 }, resolution: 2 })
      .setOrigin(0.5, 0)
      .setDepth(20);
    this.add.text(12, 10, '🎣 S3 Lake', { fontFamily: UI_FONT, fontSize: '16px', fontStyle: 'bold', color: '#0f172a', resolution: 2 }).setDepth(20);
    this.updateHud();
    this.setInfo('Click the water to cast. Each fish is an S3 object — choose the right storage class!');
  }

  private spawnSwimmer(i: number) {
    const { width: w, height: h } = this.scale;
    const y = this.waterY + 70 + ((h - this.waterY - 100) * (i + 0.5)) / 6;
    const c = this.add.container(Math.random() * w, y);
    const body = this.add.ellipse(0, 0, 34, 16, [0xfbbf24, 0xf472b6, 0xa3e635, 0xfb923c][i % 4]);
    const tail = this.add.triangle(-20, 0, 0, -8, 0, 8, 10, 0, 0xf59e0b);
    const eye = this.add.circle(10, -2, 2, 0x111827);
    c.add([tail, body, eye]).setDepth(3).setAlpha(0.9);
    const dir = Math.random() < 0.5 ? 1 : -1;
    c.setScale(dir, 1);
    c.setData('dir', dir);
    c.setData('speed', 30 + Math.random() * 40);
    this.swimmers.push(c);
  }

  override update(_t: number, dt: number) {
    const w = this.scale.width;
    for (const f of this.swimmers) {
      if (f === this.hooked || f.getData('target')) continue;
      f.x += (f.getData('dir') * f.getData('speed') * dt) / 1000;
      if (f.x > w + 30) f.x = -30;
      if (f.x < -30) f.x = w + 30;
    }
    this.line.clear();
    if (this.bobber.visible) {
      this.line.lineStyle(1.5, 0xf8fafc, 0.9).lineBetween(this.rodTip.x, this.rodTip.y, this.bobber.x, this.bobber.y);
    }
  }

  private onClick(p: Phaser.Input.Pointer) {
    if (this.state === 'ready' && p.y > this.waterY + 10) return this.cast(p.x, p.y);
    if (this.state === 'bite') return this.hook();
  }

  private cast(x: number, y: number) {
    this.state = 'casting';
    this.bobber.setPosition(this.rodTip.x, this.rodTip.y).setVisible(true);
    this.tweens.add({
      targets: this.bobber,
      x,
      y: this.waterY + 12,
      duration: 500,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.state = 'waiting';
        this.setInfo('Waiting for a bite…');
        this.tweens.add({ targets: this.bobber, y: '+=3', yoyo: true, repeat: -1, duration: 600 });
        this.time.delayedCall(900 + Math.random() * 1600, () => this.approach(x, y));
      },
    });
  }

  private approach(x: number, _y: number) {
    if (this.state !== 'waiting') return;
    const fish = this.swimmers.reduce((a, b) => (Math.abs(a.x - x) < Math.abs(b.x - x) ? a : b));
    fish.setData('target', true);
    this.tweens.add({
      targets: fish,
      x: this.bobber.x,
      y: this.bobber.y + 18,
      duration: 700,
      onComplete: () => {
        this.state = 'bite';
        this.hooked = fish;
        this.tweens.killTweensOf(this.bobber);
        this.tweens.add({ targets: this.bobber, y: this.waterY + 22, yoyo: true, repeat: 3, duration: 110 });
        this.setInfo('❗ BITE! Click now!');
        this.biteTimer = this.time.delayedCall(1100, () => this.miss());
      },
    });
  }

  private miss() {
    if (this.state !== 'bite') return;
    this.hooked?.setData('target', false);
    this.hooked = undefined;
    this.reset('It got away! Click the water to cast again.');
  }

  private hook() {
    this.biteTimer?.remove();
    const fish = this.hooked!;
    const item = this.deck[this.caught];
    this.state = 'reeling';
    this.setInfo(`Reeling in ${item.name}…`);
    this.tweens.add({ targets: [fish, this.bobber], x: this.rodTip.x + 20, y: this.waterY - 60, duration: 700, ease: 'Back.easeIn', onComplete: () => this.quiz(item) });
  }

  private quiz(item: (typeof FISH)[number]) {
    this.state = 'quiz';
    const { width: w } = this.scale;
    const cw = Math.min(420, w - 24);
    const card = this.add.container(w / 2, this.waterY + 20).setDepth(30);
    const bg = this.add.rectangle(0, 0, cw, 190, 0xffffff).setStrokeStyle(3, 0x161622).setOrigin(0.5, 0);
    const t1 = this.add.text(0, 12, `📄 ${item.name}`, { fontFamily: UI_FONT, fontSize: '17px', fontStyle: 'bold', color: '#161622', resolution: 2 }).setOrigin(0.5, 0);
    const t2 = this.add.text(0, 40, `“${item.hint}”\nWhich bucket (storage class)?`, { fontFamily: UI_FONT, fontSize: '13px', color: '#374151', align: 'center', resolution: 2 }).setOrigin(0.5, 0);
    card.add([bg, t1, t2]);
    const bw = (cw - 40) / 3;
    CLASSES.forEach((c, i) => {
      const x = -cw / 2 + 12 + bw / 2 + i * (bw + 8);
      const b = this.add.rectangle(x, 110, bw, 56, c.color).setStrokeStyle(2, 0x161622).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      const l = this.add.text(x, 118, `${c.label}\n${c.note}`, { fontFamily: UI_FONT, fontSize: '12px', fontStyle: 'bold', color: '#ffffff', align: 'center', stroke: '#161622', strokeThickness: 3, resolution: 2 }).setOrigin(0.5, 0);
      b.on('pointerdown', () => this.answer(item, c.id));
      card.add([b, l]);
    });
    this.card = card;
  }

  private answer(item: (typeof FISH)[number], choice: ClassId) {
    this.card?.destroy();
    this.card = undefined;
    this.caught++;
    const right = choice === item.answer;
    if (right) {
      this.correct++;
      useCity.getState().addXp('s3', 3);
    }
    this.hooked?.destroy();
    this.swimmers = this.swimmers.filter((f) => f !== this.hooked);
    this.hooked = undefined;
    this.spawnSwimmer(this.swimmers.length);
    this.updateHud();
    const verdict = right ? `✅ Correct! ${item.why}` : `❌ Not quite. ${item.why}`;
    if (this.caught >= ROUND) return this.summary(verdict);
    this.reset(`${verdict}\nClick the water to cast again.`);
  }

  private summary(last: string) {
    this.state = 'summary';
    this.bobber.setVisible(false);
    const perfect = this.correct === ROUND;
    if (perfect) useCity.getState().addXp('s3', 5);
    this.setInfo(`${last}\n\n🏆 ${this.correct}/${ROUND} objects in the right bucket${perfect ? ' — perfect! +5 bonus XP' : ''}.\nTip: S3 Lifecycle rules can move objects between classes automatically.`);
    const { width: w, height: h } = this.scale;
    const again = this.add.text(w / 2, h - 50, '🎣 Play again', { fontFamily: UI_FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#3f9b4f', padding: { x: 12, y: 8 }, resolution: 2 }).setOrigin(0.5).setDepth(30).setInteractive({ useHandCursor: true });
    again.on('pointerdown', () => this.scene.restart());
  }

  private reset(msg: string) {
    this.tweens.killTweensOf(this.bobber);
    this.bobber.setVisible(false);
    this.state = 'ready';
    this.setInfo(msg);
  }

  private setInfo(t: string) {
    this.info.setText(t);
  }

  private updateHud() {
    this.hud.setText(`Catches ${this.caught}/${ROUND} · Correct ${this.correct}`);
  }
}
