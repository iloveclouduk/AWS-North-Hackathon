import Phaser from 'phaser';
import { FRAME_H, FRAME_W, PIVOT } from '../../assets';
import { MiniGame, TXT } from './MiniGame';

interface Order {
  t: Phaser.GameObjects.Text;
  born: number;
  source: string;
}
interface Chef {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  busyUntil: number;
  warmUntil: number;
  provisioned: boolean;
}

const SOURCES = ['📸 S3 upload', '🌐 API request', '📬 SQS message', '⏰ EventBridge', '🔔 SNS alert'];
const MAX_CONCURRENCY = 4;
const TIMEOUT_MS = 9000;
const WARM_MS = 6000;
const COLD_MS = 1800;
const RUN_MS = 1200;

/**
 * Lambda Food Stall: event orders arrive; click one to invoke. A free warm chef serves fast; otherwise a
 * cold chef needs a cold start. Max 4 concurrent chefs; orders time out. Buy provisioned concurrency.
 */
export class KitchenGame extends MiniGame {
  private orders: Order[] = [];
  private chefs: Chef[] = [];
  private coins = 0;
  private coinText!: Phaser.GameObjects.Text;

  constructor() {
    super('game:lambda', 'lambda', 'lambda', '🍳 Lambda Food Stall — serve every event before it times out');
    this.duration = 50;
  }

  protected setup() {
    this.orders = [];
    this.chefs = [];
    this.coins = 0;
    const { width: w, height: h } = this.scale;
    const g = this.add.graphics();
    g.fillStyle(0x3f2a1d, 1).fillRect(0, h * 0.6, w, h);
    g.fillStyle(0xe8912d, 1).fillRect(w * 0.45, h * 0.18, w * 0.55, 10);
    for (let i = 0; i < 10; i++) g.fillStyle(i % 2 ? 0xffffff : 0xe8912d, 1).fillRect(w * 0.45 + (i * w * 0.55) / 10, h * 0.18 + 10, w * 0.055, 14);
    this.add.text(12, 34, 'Event queue (click to invoke)', TXT(16, '#fde68a'));
    for (let i = 0; i < MAX_CONCURRENCY; i++) {
      const x = w * 0.5 + (i * w * 0.45) / MAX_CONCURRENCY + 20;
      const sprite = this.add.sprite(x, h * 0.6, 'char:lambda', 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H).setScale(1.5).setAlpha(0.45);
      sprite.play('lambda:idle:SE');
      const label = this.add.text(x, h * 0.64, 'cold', TXT(16, '#93c5fd')).setOrigin(0.5, 0);
      this.chefs.push({ sprite, label, busyUntil: 0, warmUntil: 0, provisioned: false });
    }
    this.coinText = this.add.text(w - 12, h - 26, '', TXT(16, '#fde047')).setOrigin(1, 0);
    this.add
      .text(12, h - 26, '＋ Provisioned concurrency (5🪙)', { ...TXT(16, '#ffffff'), backgroundColor: '#14532d', padding: { x: 6, y: 2 } })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.provision());
    this.time.addEvent({ delay: 1100, loop: true, callback: () => !this.over && this.spawn() });
  }

  private spawn() {
    if (this.orders.length >= 8) return;
    const source = SOURCES[Math.floor(Math.random() * SOURCES.length)];
    const t = this.add.text(12, 0, source, { ...TXT(16, '#ffffff'), backgroundColor: '#1f2937', padding: { x: 4, y: 1 } }).setInteractive({ useHandCursor: true });
    const o: Order = { t, born: this.time.now, source };
    t.on('pointerdown', () => this.invoke(o));
    this.orders.push(o);
    this.layout();
  }

  private layout() {
    this.orders.forEach((o, i) => o.t.setY(58 + i * 24));
  }

  private invoke(o: Order) {
    if (this.over) return;
    const now = this.time.now;
    const free = this.chefs.filter((c) => c.busyUntil <= now);
    if (!free.length) {
      this.floater(o.t.x + 80, o.t.y, 'throttled! (max concurrency)', '#fca5a5');
      return;
    }
    const warm = free.find((c) => c.provisioned || c.warmUntil > now);
    const chef = warm ?? free[0];
    const cold = !warm;
    const dur = RUN_MS + (cold ? COLD_MS : 0);
    chef.busyUntil = now + dur;
    chef.warmUntil = now + dur + WARM_MS;
    chef.sprite.setAlpha(1).play('lambda:cook:SE');
    chef.label.setText(cold ? 'cold start…' : 'cooking').setColor(cold ? '#93c5fd' : '#fde047');
    this.orders = this.orders.filter((x) => x !== o);
    o.t.destroy();
    this.layout();
    this.time.delayedCall(dur, () => {
      if (this.over) return;
      const waited = this.time.now - o.born;
      if (waited > TIMEOUT_MS) {
        this.addScore(-3);
        this.floater(chef.sprite.x, chef.sprite.y - 90, 'timed out', '#fca5a5');
      } else {
        this.addScore(cold ? 6 : 10);
        this.coins++;
        this.floater(chef.sprite.x, chef.sprite.y - 90, cold ? '+6 (cold)' : '+10', '#86efac');
      }
      chef.sprite.play('lambda:idle:SE');
    });
  }

  private provision() {
    const c = this.chefs.find((x) => !x.provisioned);
    if (!c || this.coins < 5) return this.floater(this.scale.width / 2, this.scale.height - 40, 'need 5 🪙', '#fca5a5');
    this.coins -= 5;
    c.provisioned = true;
    this.floater(c.sprite.x, c.sprite.y - 90, 'always warm!', '#fde047');
  }

  override update(t: number, dt: number) {
    super.update(t, dt);
    if (this.over) return;
    const now = this.time.now;
    for (const c of this.chefs) {
      if (c.busyUntil > now) continue;
      const warm = c.provisioned || c.warmUntil > now;
      c.sprite.setAlpha(warm ? 1 : 0.45);
      c.label.setText(c.provisioned ? 'provisioned' : warm ? 'warm' : 'cold').setColor(warm ? '#86efac' : '#93c5fd');
    }
    for (const o of [...this.orders]) {
      if (now - o.born > TIMEOUT_MS) {
        this.orders = this.orders.filter((x) => x !== o);
        o.t.destroy();
        this.addScore(-3);
        this.layout();
      } else if (now - o.born > TIMEOUT_MS * 0.6) o.t.setColor('#fca5a5');
    }
    this.coinText?.setText(`🪙 ${this.coins}`);
  }

  protected lesson() {
    return 'Lambda runs your code only when an event arrives. A new execution environment needs a cold start; warm ones are reused. Account/function concurrency limits cause throttling, functions time out (max 15 min), and provisioned concurrency keeps environments initialised for steady latency.';
  }
}
