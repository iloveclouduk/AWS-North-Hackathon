import Phaser from 'phaser';
import { FRAME_H, FRAME_W, PIVOT, citizenIds } from '../../assets';
import { sfx } from '../../audio';
import { crisp } from '../../SpeechBubble';
import { MiniGame, PAL, TXT } from './MiniGame';
import { addServer, arrivals, newRush, PHASES, phaseAt, removeServer, RUSH, RUSH_LESSON, rushStars, rushVerdict, serverCount, tick, type Phase, type RushState } from './rushHour';

interface Slot {
  body: Phaser.GameObjects.Rectangle;
  leds: Phaser.GameObjects.Rectangle[];
  label: Phaser.GameObjects.Text;
}

const SKY: Record<Phase, number> = { morning: 0x3b5b8c, lunch: 0x2f7fbf, evening: 0x2a1f4d };
/** Customers drawn in the line; more show as "+N". */
const SHOWN = 10;

/**
 * EC2 Rush Hour: customers come in waves (quiet morning, lunch rush, calm evening). Add servers when the
 * line grows and remove them when they sit idle. That's the job Auto Scaling does for you.
 */
export class RushGame extends MiniGame {
  private s: RushState = newRush();
  private phase: Phase = 'morning';
  private wasLong = false;
  private wasIdle = false;
  private slots: Slot[] = [];
  private line: Phaser.GameObjects.Sprite[] = [];
  private lineText!: Phaser.GameObjects.Text;
  private moreText!: Phaser.GameObjects.Text;
  private serversText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private sky!: Phaser.GameObjects.Rectangle;
  private sun!: Phaser.GameObjects.Rectangle;
  private eddie!: Phaser.GameObjects.Sprite;

  constructor() {
    super('game:ec2', 'ec2', 'ec2', '🏭 EC2 Rush Hour — tap + when the line grows, − when servers sit idle');
    this.duration = RUSH.seconds;
    this.clockIsTheGame = true;
  }

  protected setup() {
    this.s = newRush();
    this.phase = 'morning';
    this.wasLong = this.wasIdle = false;
    this.slots = [];
    this.line = [];
    const { width: w, height: h } = this.scale;
    const top = this.top;
    const groundY = Math.round(h * 0.74);
    this.sky = this.add.rectangle(0, 0, w, groundY, SKY.morning).setOrigin(0);
    this.sun = this.add.rectangle(w * 0.14, top + 40, 18, 18, 0xfde047).setStrokeStyle(2, PAL.black);
    const g = this.add.graphics();
    // street and sidewalk
    g.fillStyle(0x6b7280, 1).fillRect(0, groundY - 6, w, 8);
    g.fillStyle(0x374151, 1).fillRect(0, groundY + 2, w, h - groundY);
    for (let x = 10; x < w; x += 40) g.fillStyle(0x4b5563, 1).fillRect(x, groundY + 30, 20, 3);
    // the factory: orange walls, a roof sign and eight server slots
    const fx = Math.round(w * 0.44);
    const fw = w - fx - 8;
    const fy = top + 34;
    const fh = groundY - 6 - fy;
    g.fillStyle(PAL.black, 1).fillRect(fx - 2, fy - 2, fw + 4, fh + 4);
    g.fillStyle(0xb45309, 1).fillRect(fx, fy, fw, fh);
    g.fillStyle(0xed7100, 1).fillRect(fx, fy, fw, 6);
    g.fillStyle(0x7c2d12, 1).fillRect(fx + 10, fy - 14, 10, 14).fillRect(fx + fw - 22, fy - 18, 10, 18); // chimneys
    crisp(this.add.text(fx + fw / 2, fy + 16, 'EC2 FACTORY', TXT(14, '#ffffff'))).setOrigin(0.5);
    const cols = 4;
    const gap = 6;
    const sw = (fw - 16 - gap * (cols - 1)) / cols;
    const sh = Math.min(70, (fh - 44 - gap) / 2);
    for (let i = 0; i < RUSH.maxServers; i++) {
      const x = fx + 8 + (i % cols) * (sw + gap);
      const y = fy + 30 + Math.floor(i / cols) * (sh + gap);
      this.add.rectangle(x, y, sw, sh, 0x1f2937).setOrigin(0).setStrokeStyle(2, PAL.black);
      const body = this.add.rectangle(x + 4, y + 4, sw - 8, sh - 22, 0x111827).setOrigin(0);
      const leds = [0, 1, 2].map((k) => this.add.rectangle(x + 9 + k * 9, y + 10, 5, 5, 0x374151).setOrigin(0));
      const label = crisp(this.add.text(x + sw / 2, y + sh - 9, '', TXT(12, PAL.muted))).setOrigin(0.5);
      this.slots.push({ body, leds, label });
    }
    // Eddie at the door, and the line of customers waiting outside
    const scale = Phaser.Math.Clamp(Math.floor((h / 300) * 2) / 2, 1, 2);
    this.eddie = this.add.sprite(fx - 4, groundY, 'char:ec2', 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H).setScale(scale).setFlipX(true);
    this.eddie.play('ec2:idle:SE');
    const ids = citizenIds();
    const step = Math.min(18, (fx - 40) / SHOWN);
    for (let i = 0; i < SHOWN; i++) {
      const id = ids[(i * 3) % ids.length];
      const sp = this.add.sprite(fx - 26 - i * step, groundY + 2, `char:${id}`, 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H).setScale(Math.max(1, scale - 0.5)).setVisible(false);
      sp.play(`${id}:idle:SE`);
      this.line.push(sp);
    }
    this.moreText = crisp(this.add.text(8, groundY - 60, '', { ...TXT(14, '#ffffff'), backgroundColor: '#140d1fcc', padding: { x: 4, y: 1 } })).setOrigin(0, 0.5);
    this.lineText = crisp(this.add.text(fx / 2, top + 76, '', { ...TXT(15, '#ffffff'), backgroundColor: '#140d1fcc', padding: { x: 6, y: 2 } })).setOrigin(0.5);
    this.phaseText = crisp(this.add.text(fx / 2, top + 14, PHASES[0].label, { ...TXT(15, '#fde047'), backgroundColor: '#140d1fcc', padding: { x: 6, y: 2 } })).setOrigin(0.5);
    // controls: − servers +
    const by = h - 24;
    this.pxButton(Math.max(46, w / 2 - 110), by, '− server', () => this.remove(), 0x2d2144, '#ffffff');
    this.serversText = crisp(this.add.text(w / 2, by, '', TXT(15, '#ffffff'))).setOrigin(0.5);
    this.pxButton(Math.min(w - 46, w / 2 + 110), by, '+ server', () => this.add1(), PAL.accent, PAL.accentInk);
    this.onKeys((k) => {
      if (k === '+' || k === '=' || k === 'ArrowUp' || k === 'ArrowRight') this.add1();
      else if (k === '-' || k === '_' || k === 'ArrowDown' || k === 'ArrowLeft') this.remove();
    });
    this.time.addEvent({ delay: this.tickMs, loop: true, callback: () => this.second() });
    this.draw();
  }

  private add1() {
    if (this.over) return;
    if (!addServer(this.s)) return (this.miss(), this.floater(this.scale.width / 2, this.scale.height - 56, 'the factory is full', PAL.bad));
    sfx('pop', { own: true });
    this.draw();
  }

  private remove() {
    if (this.over) return;
    if (!removeServer(this.s)) return (this.miss(), this.floater(this.scale.width / 2, this.scale.height - 56, 'keep one server on', PAL.bad));
    sfx('whoosh', { own: true });
    this.draw();
  }

  /** One second of the day. */
  private second() {
    if (this.over) return;
    const r = tick(this.s, arrivals(this.s.t));
    this.addScore(r.points, 'none');
    const { width: w, height: h } = this.scale;
    const fx = w * 0.44;
    const phase = phaseAt(this.s.t);
    if (phase !== this.phase) {
      this.phase = phase;
      const p = PHASES.find((x) => x.id === phase)!;
      this.phaseText.setText(p.label);
      this.floater(w / 2, h * 0.42, p.label, '#fde047');
      sfx('pop', { soft: true });
    }
    if (r.long && !this.wasLong) {
      this.floater(fx / 2, this.top + 104, 'Line too long! Tap +', PAL.bad);
      sfx('wrong', { soft: true });
    }
    if (r.lost) this.floater(fx / 2, this.top + 124, `${r.lost} gave up and left`, PAL.bad);
    const idle = r.idle >= 2;
    if (idle && !this.wasIdle) this.floater(fx + (w - fx) / 2, h * 0.7, '💤 idle servers still cost money', '#93c5fd');
    this.wasLong = r.long;
    this.wasIdle = idle;
    this.draw(r.served);
  }

  private draw(served = 0) {
    const s = this.s;
    const busy = Math.min(s.ready, Math.ceil(served / RUSH.perServer));
    this.slots.forEach((slot, i) => {
      const state = i < busy ? 'busy' : i < s.ready ? 'idle' : i < s.ready + s.booting.length ? 'boot' : 'off';
      const lit = state === 'busy' ? 0x6fe3a3 : state === 'boot' ? (s.t % 2 ? 0xffb84d : 0x7c4a03) : state === 'idle' ? 0x64748b : 0x1f2937;
      slot.leds.forEach((l, k) => l.setFillStyle(state === 'busy' && (s.t + k) % 3 === 0 ? 0xd1fae5 : lit));
      slot.body.setFillStyle(state === 'off' ? 0x0b0f17 : 0x111827);
      slot.label.setText({ busy: 'busy', idle: 'idle 💤', boot: 'starting', off: '' }[state]).setColor(state === 'busy' ? PAL.good : state === 'boot' ? '#ffb84d' : PAL.muted);
    });
    this.line.forEach((sp, i) => sp.setVisible(i < s.queue));
    this.moreText.setText(s.queue > SHOWN ? `+${s.queue - SHOWN}` : '');
    const long = s.queue >= RUSH.longQueue;
    this.lineText.setText(`Line: ${s.queue}`).setColor(long ? PAL.bad : '#ffffff');
    this.serversText.setText(`Servers ${serverCount(s)}/${RUSH.maxServers}`);
    const want = busy ? 'ec2:hammer:SE' : 'ec2:idle:SE';
    if (this.eddie.anims.currentAnim?.key !== want) this.eddie.play(want);
    this.sky.setFillStyle(SKY[this.phase]);
    const { width: w } = this.scale;
    // the sun climbs to noon, then sets; in the evening it's the moon
    const t = s.t / RUSH.seconds;
    this.sun.setPosition(w * (0.08 + 0.3 * t), this.top + 40 - Math.sin(Math.PI * t) * 10).setFillStyle(this.phase === 'evening' ? 0xe2e8f0 : 0xfde047);
  }

  protected lesson() {
    // One line a kid can read. Launch templates, health checks and scaling policies are in the EC2 flashcards.
    const st = this.s.stats;
    return `${'⭐'.repeat(rushStars(st))} ${rushVerdict(st)} ${RUSH_LESSON}`;
  }
}
