import Phaser from 'phaser';
import { FRAME_H, FRAME_W, PIVOT } from '../../assets';
import { MiniGame, pace, PAL, TXT } from './MiniGame';
import { crisp } from '../../SpeechBubble';

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
/** How often an idle provisioned chef costs a coin (provisioned concurrency is billed while it waits). */
const IDLE_BILL_MS = 8000;
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
  /** Where the order tickets stack (the chalkboard). */
  private board = { x: 0, y: 0, rows: 8 };

  constructor() {
    super('game:lambda', 'lambda', 'lambda', '🍳 Lambda Food Stall — click an order (or Space) to invoke a chef before it expires');
    this.duration = 50;
  }

  protected setup() {
    this.orders = [];
    this.chefs = [];
    this.coins = 0;
    const { width: w, height: h } = this.scale;
    const top = this.top;
    const floorY = Math.round(h * 0.74);
    // Chefs grow with the stage so the full tab isn't a wall of empty bricks.
    const chefScale = Phaser.Math.Clamp(Math.floor((h / 260) * 2) / 2, 1.5, 3);
    const g = this.add.graphics();
    // back wall: bricks
    g.fillStyle(0x5b2c2c, 1).fillRect(0, 0, w, floorY);
    for (let y = top, row = 0; y < floorY; y += 12, row++)
      for (let x = (row % 2) * -14; x < w; x += 28) g.fillStyle(row % 3 ? 0x6b3434 : 0x733a3a, 1).fillRect(x + 1, y + 1, 26, 10);
    // awning: orange and white stripes with a scalloped edge
    const aw = top + 4;
    for (let i = 0, n = Math.ceil(w / 32); i < n; i++) {
      g.fillStyle(i % 2 ? 0xffffff : 0xed7100, 1).fillRect(i * 32, aw, 32, 22);
      g.fillStyle(i % 2 ? 0xffffff : 0xed7100, 1).fillRect(i * 32 + 4, aw + 22, 24, 6);
    }
    g.fillStyle(0x000000, 0.25).fillRect(0, aw + 28, w, 4);
    // floor: checker tiles
    for (let y = floorY, r = 0; y < h; y += 20, r++) for (let x = 0, c = 0; x < w; x += 20, c++) g.fillStyle((r + c) % 2 ? 0x3f2a1d : 0x4a3222, 1).fillRect(x, y, 20, 20);
    // chalkboard of incoming events
    const bx = 10;
    const by = aw + 42;
    const bw = Math.min(210, Math.round(w * 0.38));
    const bh = floorY - by - 8;
    g.fillStyle(0x8b5a2b, 1).fillRect(bx, by, bw, bh);
    g.fillStyle(0x1f3b2d, 1).fillRect(bx + 5, by + 5, bw - 10, bh - 10);
    crisp(this.add.text(bx + bw / 2, by + 16, 'ORDERS · events', TXT(14, '#e2e8f0'))).setOrigin(0.5);
    this.board = { x: bx + 12, y: by + 32, rows: Math.max(3, Math.min(8, Math.floor((bh - 40) / 26))) };
    // counter + stoves for the chefs, under a hanging λ sign and lamps
    const left = bx + bw + 24;
    const counterY = floorY - 4;
    const signX = left + (w - left) / 2;
    const signY = aw + 60;
    g.fillStyle(0x000000, 1).fillRect(signX - 1, aw + 32, 2, signY - aw - 50);
    g.fillStyle(0x000000, 1).fillRect(signX - 46, signY - 20, 92, 40);
    g.fillStyle(0xed7100, 1).fillRect(signX - 44, signY - 18, 88, 36);
    crisp(this.add.text(signX, signY, 'λ  STALL', TXT(20, '#ffffff'))).setOrigin(0.5);
    for (let i = 0; i < MAX_CONCURRENCY; i++) {
      const x = left + ((i + 0.5) * (w - left - 16)) / MAX_CONCURRENCY;
      g.fillStyle(0x000000, 1).fillRect(x - 1, aw + 32, 2, 24);
      g.fillStyle(0xfde047, 1).fillRect(x - 7, aw + 56, 14, 6);
      g.fillStyle(0xfde047, 0.08).fillTriangle(x, aw + 62, x - 40, counterY, x + 40, counterY);
    }
    g.fillStyle(0x000000, 1).fillRect(left - 8, counterY - 2, w - left, 30);
    g.fillStyle(0x9a6b3e, 1).fillRect(left - 8, counterY, w - left, 26);
    g.fillStyle(0xb57f4a, 1).fillRect(left - 8, counterY, w - left, 5);
    for (let i = 0; i < MAX_CONCURRENCY; i++) {
      const x = left + ((i + 0.5) * (w - left - 16)) / MAX_CONCURRENCY;
      g.fillStyle(0x334155, 1).fillRect(x - 20, counterY - 8, 40, 8);
      g.fillStyle(0x0f172a, 1).fillRect(x - 14, counterY - 12, 28, 4);
      const sprite = this.add.sprite(x, counterY - 6, 'char:lambda', 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H).setScale(chefScale).setAlpha(0.45);
      sprite.play('lambda:idle:SE');
      const label = crisp(this.add.text(x, counterY + 34, 'cold', { ...TXT(14, '#93c5fd'), backgroundColor: '#140d1fcc', padding: { x: 5, y: 1 } })).setOrigin(0.5, 0);
      this.chefs.push({ sprite, label, busyUntil: 0, warmUntil: 0, provisioned: false });
    }
    this.coinText = crisp(this.add.text(w - 12, h - 18, '', { ...TXT(16, '#fde047'), backgroundColor: '#140d1fcc', padding: { x: 6, y: 2 } })).setOrigin(1, 0.5);
    this.pxButton(Math.min(150, w / 2 - 10), h - 20, '+ Provisioned · 5🪙 (bills idle)', () => this.provision(), 0x6fe3a3, PAL.paperInk);
    // Keyboard: Space serves the oldest order, P buys an always-warm chef.
    this.onKeys((k) => {
      if (k === ' ' && this.orders[0]) this.invoke(this.orders[0]);
      else if (k === 'p' || k === 'P') this.provision();
    });
    this.time.addEvent({ delay: pace(1100), loop: true, callback: () => !this.over && this.spawn() });
    // Provisioned concurrency is billed while it waits, not only while it cooks: each idle provisioned chef costs a
    // coin every few seconds, and goes back to on-demand when the coins run out.
    this.time.addEvent({ delay: pace(IDLE_BILL_MS), loop: true, callback: () => !this.over && this.billIdle() });
  }

  private spawn() {
    if (this.orders.length >= this.board.rows) return;
    const source = SOURCES[Math.floor(Math.random() * SOURCES.length)];
    const t = crisp(this.add.text(this.board.x, 0, source, { ...TXT(15, PAL.paperInk), backgroundColor: '#fffbeb', padding: { x: 6, y: 3 } })).setInteractive({ useHandCursor: true });
    const o: Order = { t, born: this.time.now, source };
    t.on('pointerdown', () => this.invoke(o));
    this.orders.push(o);
    this.layout();
  }

  private layout() {
    this.orders.forEach((o, i) => o.t.setY(this.board.y + i * 26));
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
      if (waited > pace(TIMEOUT_MS)) {
        this.addScore(-3, 'soft');
        this.floater(chef.sprite.x, chef.sprite.y - chef.sprite.displayHeight * 0.85, 'order expired', '#fca5a5');
      } else {
        this.addScore(cold ? 6 : 10, 'soft');
        this.coins++;
        this.floater(chef.sprite.x, chef.sprite.y - chef.sprite.displayHeight * 0.85, cold ? '+6 (cold)' : '+10', '#86efac');
      }
      chef.sprite.play('lambda:idle:SE');
    });
  }

  private billIdle() {
    const now = this.time.now;
    for (const c of this.chefs) {
      if (!c.provisioned || c.busyUntil > now) continue;
      const y = c.sprite.y - c.sprite.displayHeight * 0.85;
      if (this.coins > 0) {
        this.coins--;
        this.floater(c.sprite.x, y, '−1🪙 idle', '#fde047');
      } else {
        c.provisioned = false;
        this.floater(c.sprite.x, y, 'released: no coins', '#93c5fd');
      }
    }
  }

  private provision() {
    if (this.over) return;
    const c = this.chefs.find((x) => !x.provisioned);
    if (!c || this.coins < 5) return this.floater(this.scale.width / 2, this.scale.height - 48, 'need 5 🪙', '#fca5a5');
    this.coins -= 5;
    c.provisioned = true;
    this.floater(c.sprite.x, c.sprite.y - c.sprite.displayHeight * 0.85, 'always warm!', '#fde047');
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
      if (now - o.born > pace(TIMEOUT_MS)) {
        this.orders = this.orders.filter((x) => x !== o);
        o.t.destroy();
        this.addScore(-3, 'soft');
        this.layout();
      } else if (now - o.born > pace(TIMEOUT_MS) * 0.6) o.t.setColor('#b91c1c').setBackgroundColor('#fee2e2');
    }
    this.coinText?.setText(`🪙 ${this.coins}`);
  }

  protected lesson() {
    // One line a kid can read. Cold starts, throttling and the 15-minute limit are in the Lambda flashcards.
    return 'Lola only cooks when an order comes in, so an empty stall costs nothing. Always-warm (provisioned) chefs cost money even while they wait.';
  }
}
