import Phaser from 'phaser';
import { FRAME_H, FRAME_W, PIVOT } from '../../assets';
import { sfx } from '../../audio';
import { reducedMotion } from '../../motion';
import { crisp } from '../../SpeechBubble';
import { MiniGame, pace, PAL, TXT } from './MiniGame';
import { drain, isHot, label, newSortStats, nextParcel, send, shelfFor, SHELVES, SORT, SORT_LESSON, sortPoints, sortStars, sortVerdict, spawnMs, type Parcel, type SortStats } from './sorting';

interface Box {
  p: Parcel;
  t: Phaser.GameObjects.Text;
  /** When it reached the front of the belt. */
  front?: number;
}
interface Shelf {
  x: number;
  keys: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
  busy: Phaser.GameObjects.Text;
}

const SHELF_COLORS = [0xdd344c, 0xfde047, 0x8c4fff, 0x01a88d];

/**
 * DynamoDB Sorting Office: each parcel's key says which shelf it lives on. Send it there fast. In the
 * hot moment one key floods in and its shelf gets too busy (throttled) until you spread the key.
 */
export class SortGame extends MiniGame {
  private belt: Box[] = [];
  private shelves: Shelf[] = [];
  private loads: number[] = [];
  private stats: SortStats = newSortStats();
  private started = 0;
  private hotShown = false;
  private tipShown = false;
  private spreadBtn?: Phaser.GameObjects.Container;
  private hint!: Phaser.GameObjects.Text;
  private dyna!: Phaser.GameObjects.Sprite;
  private geo = { beltY: 0, frontX: 0, step: 0, shelfTop: 0, shelfW: 0, shelfH: 0 };

  constructor() {
    super('game:dynamodb', 'dynamodb', 'dynamodb', '📦 DynamoDB Sorting Office — send each parcel to the shelf with its key');
    this.duration = SORT.seconds;
  }

  protected setup() {
    this.belt = [];
    this.shelves = [];
    this.loads = SHELVES.map(() => 0);
    this.stats = newSortStats();
    this.hotShown = this.tipShown = false;
    this.spreadBtn = undefined;
    this.started = this.time.now;
    const { width: w, height: h } = this.scale;
    const top = this.top;
    const g = this.add.graphics();
    // library wall (Database Row purple) and a wooden floor
    g.fillStyle(0x2a1035, 1).fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 36) g.fillStyle(0x341443, 1).fillRect(x, top, 18, h);
    // the belt
    const beltY = top + 34;
    g.fillStyle(PAL.black, 1).fillRect(0, beltY - 18, w, 36);
    g.fillStyle(0x334155, 1).fillRect(0, beltY - 16, w, 32);
    for (let x = 6; x < w; x += 22) g.fillStyle(0x475569, 1).fillRect(x, beltY - 16, 4, 32);
    const frontX = 44;
    g.fillStyle(0xffb84d, 1).fillRect(frontX - 30, beltY + 18, 60, 4);
    crisp(this.add.text(frontX, beltY + 30, 'sort me', TXT(12, '#ffb84d'))).setOrigin(0.5);
    // Dyna in the middle, sorting
    const shelfTop = Math.round(Math.max(beltY + 120, h * 0.5));
    const scale = Phaser.Math.Clamp(Math.floor((h / 300) * 2) / 2, 1, 2);
    this.dyna = this.add.sprite(w / 2, shelfTop - 26, 'char:dynamodb', 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H).setScale(scale);
    this.dyna.play('dynamodb:idle:SE');
    // four shelves (partitions), each with its keys, a busy meter and a tap zone
    const n = SHELVES.length;
    const gap = 6;
    const shelfW = (w - 16 - gap * (n - 1)) / n;
    const shelfH = h - 48 - shelfTop;
    SHELVES.forEach((keys, i) => {
      const x = 8 + i * (shelfW + gap);
      const cx = x + shelfW / 2;
      g.fillStyle(PAL.black, 1).fillRect(x - 2, shelfTop - 2, shelfW + 4, shelfH + 4);
      g.fillStyle(0x7c4a21, 1).fillRect(x, shelfTop, shelfW, shelfH);
      for (let y = shelfTop + 44; y < shelfTop + shelfH - 6; y += 22) g.fillStyle(0x5b3415, 1).fillRect(x + 4, y, shelfW - 8, 4);
      g.fillStyle(SHELF_COLORS[i], 1).fillRect(x, shelfTop, shelfW, 6);
      crisp(this.add.text(cx, shelfTop + 16, `${i + 1}`, TXT(18, '#ffffff'))).setOrigin(0.5);
      const keyText = crisp(this.add.text(cx, shelfTop + 36, keys.join(' '), { ...TXT(16, '#ffffff'), align: 'center' })).setOrigin(0.5, 0);
      this.add.rectangle(x + 4, shelfTop + shelfH - 12, shelfW - 8, 8, 0x1f2937).setOrigin(0, 0.5).setStrokeStyle(1, PAL.black);
      const bar = this.add.rectangle(x + 5, shelfTop + shelfH - 12, 0, 6, 0x6fe3a3).setOrigin(0, 0.5);
      const busy = crisp(this.add.text(cx, shelfTop + shelfH - 26, '', { ...TXT(12, PAL.bad), backgroundColor: '#140d1fcc', padding: { x: 3, y: 1 } })).setOrigin(0.5);
      this.add
        .zone(x, shelfTop, shelfW, shelfH)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.sortTo(i));
      this.shelves.push({ x: cx, keys: keyText, bar, busy });
    });
    this.geo = { beltY, frontX, step: Math.min(46, (w - frontX - 20) / SORT.beltMax), shelfTop, shelfW, shelfH };
    this.hint = crisp(this.add.text(w / 2, h - 22, 'Tap the shelf with the parcel’s key (or press 1–4)', { ...TXT(13, PAL.muted), align: 'center', wordWrap: { width: w - 24 } })).setOrigin(0.5);
    this.onKeys((k) => {
      const i = Number(k) - 1;
      if (i >= 0 && i < SHELVES.length) this.sortTo(i);
      else if ((k === 's' || k === 'S') && this.spreadBtn) this.spread();
    });
    this.spawn();
    this.scheduleSpawn();
  }

  /** Keeps a floater over a shelf on screen. */
  private near(x: number) {
    return Phaser.Math.Clamp(x, 90, this.scale.width - 90);
  }

  private get t() {
    return (this.time.now - this.started) / 1000;
  }

  private scheduleSpawn() {
    this.time.delayedCall(pace(spawnMs(this.t)), () => {
      if (this.over) return;
      this.spawn();
      this.scheduleSpawn();
    });
  }

  private spawn() {
    if (this.belt.length >= SORT.beltMax) {
      this.stats.dropped++;
      this.addScore(-2, 'soft');
      this.floater(this.scale.width - 60, this.geo.beltY + 30, 'a parcel fell off!', PAL.bad);
      return;
    }
    const p = nextParcel(this.t, this.stats.spread);
    const t = crisp(this.add.text(this.scale.width + 30, this.geo.beltY, label(p), { ...TXT(18, PAL.paperInk), backgroundColor: '#fffbeb', padding: { x: 6, y: 4 } })).setOrigin(0.5);
    this.belt.push({ p, t });
    this.layout();
  }

  /** Parcels slide up the belt; the first one is the one to sort. */
  private layout() {
    const { frontX, step, beltY } = this.geo;
    this.belt.forEach((b, i) => {
      const x = frontX + i * step;
      if (i === 0 && b.front === undefined) b.front = this.time.now;
      b.t.setScale(i === 0 ? 1.15 : 0.9).setDepth(i === 0 ? 20 : 10);
      if (reducedMotion()) b.t.setPosition(x, beltY);
      else this.tweens.add({ targets: b.t, x, y: beltY, duration: 180, ease: 'Stepped', easeParams: [4] });
    });
  }

  private sortTo(i: number) {
    if (this.over) return;
    const b = this.belt[0];
    if (!b) return;
    const shelf = this.shelves[i];
    const right = shelfFor(b.p);
    if (right !== i) {
      this.stats.wrong++;
      this.addScore(-3);
      this.floater(this.near(shelf.x), this.geo.shelfTop - 10, `${label(b.p)} lives on shelf ${right + 1}`, PAL.bad);
      return;
    }
    if (send(this.loads, i) === 'busy') {
      this.stats.throttled++;
      this.miss();
      this.floater(this.near(shelf.x), this.geo.shelfTop - 10, 'too busy! wait…', PAL.bad);
      if (!this.stats.spread && this.spreadBtn && !this.tipShown) {
        this.tipShown = true;
        this.hint.setText('One shelf has all the 🍎. Tap 🔀 to spread the keys (or press S)').setColor('#fde047');
      }
      return;
    }
    const pts = sortPoints(this.time.now - (b.front ?? this.time.now));
    this.stats.sorted++;
    this.addScore(pts);
    this.floater(this.near(shelf.x), this.geo.shelfTop - 10, `+${pts}`, PAL.good);
    this.belt.shift();
    this.dyna.play('dynamodb:file:SE');
    this.time.delayedCall(600, () => !this.over && this.dyna.play('dynamodb:idle:SE'));
    this.tweens.killTweensOf(b.t);
    if (reducedMotion()) b.t.destroy();
    else this.tweens.add({ targets: b.t, x: shelf.x, y: this.geo.shelfTop + this.geo.shelfH / 2, scale: 0.6, duration: 220, onComplete: () => b.t.destroy() });
    this.layout();
  }

  private spread() {
    if (this.over || this.stats.spread) return;
    this.stats.spread = true;
    this.spreadBtn?.destroy();
    this.spreadBtn = undefined;
    const hot = SORT.hotKey;
    this.shelves.forEach((s, i) => s.keys.setText(`${SHELVES[i].join(' ')}\n${hot}${i + 1}`));
    this.hint.setText(`Now ${hot} gets a number: ${hot}1 goes on shelf 1, ${hot}2 on shelf 2…`).setColor('#fde047');
    this.floater(this.scale.width / 2, this.geo.shelfTop - 40, 'Keys spread out!', '#fde047');
    sfx('correct', { own: true });
  }

  override update(t: number, dt: number) {
    super.update(t, dt);
    if (this.over) return;
    this.loads = drain(this.loads, dt / 1000);
    this.shelves.forEach((s, i) => {
      const f = this.loads[i] / SORT.shelfCap;
      s.bar.setSize((this.geo.shelfW - 10) * f, 6).setFillStyle(f > 0.67 ? 0xff6b6b : f > 0.34 ? 0xffb84d : 0x6fe3a3);
      s.busy.setText(this.loads[i] + 1 > SORT.shelfCap ? 'too busy' : '');
    });
    if (!this.hotShown && isHot(this.t)) {
      this.hotShown = true;
      const { width: w, height: h } = this.scale;
      this.floater(w / 2, this.geo.beltY + 60, `So many ${SORT.hotKey}!`, '#fde047');
      if (!this.stats.spread) {
        this.hint.setText('');
        this.spreadBtn = this.pxButton(w / 2, h - 22, `🔀 Spread the ${SORT.hotKey} keys`, () => this.spread(), 0x6fe3a3, PAL.paperInk);
      }
      sfx('pop', { soft: true });
    }
  }

  protected lesson() {
    // One line a kid can read. Partition keys, hashing and write sharding are in the DynamoDB flashcards.
    return `${'⭐'.repeat(sortStars(this.stats))} ${sortVerdict(this.stats)} ${SORT_LESSON}`;
  }
}
