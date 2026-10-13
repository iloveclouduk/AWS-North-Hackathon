import Phaser from 'phaser';
import { FRAME_H, FRAME_W, PIVOT, citizenIds } from '../../assets';
import { MiniGame, PAL, TXT } from './MiniGame';
import { crisp } from '../../SpeechBubble';
import { useCity } from '@/state/store';
import { DNS_QUESTIONS, type DnsQuestion } from '@/world/minigames';
import { dealRound } from '../../pace';

type Q = DnsQuestion;

/** Route 53 Dance Hall: every dancer asks a DNS question — call the right record type or routing policy. */
export class DanceGame extends MiniGame {
  private round = 0;
  private deck: Q[] = [];
  private ui: Phaser.GameObjects.GameObject[] = [];
  private dancers: Phaser.GameObjects.Sprite[] = [];

  constructor() {
    super('game:route53', 'route53', 'route53', '💃 Route 53 Dance Hall — every dancer asks a DNS question: call the answer (1–4)');
    this.duration = 0;
  }

  protected setup() {
    this.round = 0;
    this.dancers = [];
    this.deck = dealRound(DNS_QUESTIONS, useCity.getState().progress.games?.route53?.plays ?? 0, 8);
    const { width: w, height: h } = this.scale;
    const g = this.add.graphics();
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 16; x++) g.fillStyle((x + y) % 2 ? 0x4c1d95 : 0x6d28d9, 1).fillRect((x * w) / 16, h * 0.55 + (y * h * 0.45) / 8, w / 16 + 1, (h * 0.45) / 8 + 1);
    g.fillStyle(0x1e1b4b, 1).fillRect(0, 0, w, h * 0.55);
    // spotlights fanning down from a disco ball
    const ballX = w / 2;
    const ballY = this.top + 14;
    [0xf472b6, 0xfde047, 0x60a5fa, 0x6fe3a3].forEach((c, i) => {
      const dx = (i - 1.5) * w * 0.3;
      g.fillStyle(c, 0.07).fillTriangle(ballX, ballY, ballX + dx - 60, h * 0.95, ballX + dx + 60, h * 0.95);
    });
    g.fillStyle(0x000000, 1).fillRect(ballX - 1, 0, 2, ballY - 10);
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) g.fillStyle((x + y) % 2 ? 0xe2e8f0 : 0x94a3b8, 1).fillRect(ballX + x * 4 - 2, ballY + y * 4 - 2, 4, 4);
    for (let i = 0; i < 14; i++) this.add.rectangle((i * 131) % w, this.top + ((i * 71) % Math.max(1, h * 0.45)), 3, 3, [0xf472b6, 0xfde047, 0x60a5fa][i % 3]);
    const ids = citizenIds();
    // Ruby the caller
    this.add.sprite(w / 2, h * 0.62, 'char:route53', 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H).setScale(2).play('route53:dance:SE');
    for (let i = 0; i < 8; i++) {
      const s = this.add.sprite(40 + ((w - 80) * i) / 7, h * 0.95, `char:${ids[i % ids.length]}`, 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H).setScale(1.5);
      s.play(`${ids[i % ids.length]}:idle:SE`);
      this.dancers.push(s);
    }
    // 1-4 answer from the keyboard, like the sorting office and rush hour.
    this.onKeys((k) => {
      const o = this.asking?.opts[Number(k) - 1];
      if (this.asking && o) this.answer(this.asking.q, o);
    });
    this.ask();
  }

  /** The question on the floor and its answers in button order (cleared once answered, so a key can't answer twice). */
  private asking?: { q: Q; opts: string[] };

  private ask() {
    for (const o of this.ui) o.destroy();
    this.ui = [];
    if (this.round >= this.deck.length) return this.finish();
    const q = this.deck[this.round];
    const { width: w } = this.scale;
    // The question on a paper card, the answers as pixel buttons.
    const cw = Math.min(460, w - 24);
    const cy = this.top + 36;
    const text = crisp(this.add.text(w / 2, cy + 26, `“${q.q}”`, { ...TXT(16, PAL.paperInk), align: 'center', wordWrap: { width: cw - 28 } })).setOrigin(0.5, 0).setDepth(51);
    const ch = text.height + 40;
    this.ui.push(
      this.add.rectangle(w / 2, cy + ch / 2 + 4, cw, ch, PAL.black).setDepth(50),
      this.add.rectangle(w / 2, cy + ch / 2, cw, ch, PAL.paper).setStrokeStyle(3, PAL.black).setDepth(50),
      crisp(this.add.text(w / 2, cy + 8, `Dancer ${this.round + 1}/${this.deck.length} asks`, TXT(14, '#92400e'))).setOrigin(0.5, 0).setDepth(51),
      text,
    );
    const opts = Phaser.Utils.Array.Shuffle([...q.options]);
    this.asking = { q, opts };
    // Short answers (A, MX) fit in one row; longer ones (Private hosted zone) go in a 2×2 grid so they never overlap.
    const grid = opts.some((o) => o.length > 9) || (w - 20) / opts.length < 90;
    const cols = grid ? 2 : opts.length;
    const step = grid ? Math.min(230, (w - 20) / 2) : Math.min(118, (w - 20) / opts.length);
    opts.forEach((o, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = w / 2 + (col - (cols - 1) / 2) * step;
      this.ui.push(this.pxButton(x, cy + ch + 26 + row * 40, `${i + 1} ${o}`, () => this.answer(q, o), 0x8c4fff, '#ffffff'));
    });
  }

  private answer(q: Q, o: string) {
    if (this.asking?.q !== q) return;
    this.asking = undefined;
    const { width: w, height: h } = this.scale;
    const ok = o === q.answer;
    if (ok) this.addScore(15);
    else this.miss();
    const d = this.dancers[this.round];
    const id = (d.texture.key as string).replace('char:', '');
    d.play(`${id}:${ok ? 'dance' : 'laugh'}:SE`);
    for (const x of this.ui) (x as Phaser.GameObjects.Container).disableInteractive?.();
    this.ui.push(
      crisp(
        this.add.text(w / 2, h * 0.62, `${ok ? '✓ Right!' : `✗ It’s ${q.answer}.`} ${q.why}`, {
          ...TXT(16, ok ? '#86efac' : '#fca5a5'),
          align: 'center',
          wordWrap: { width: w - 40 },
          backgroundColor: '#140d1fe6',
          padding: { x: 10, y: 6 },
        }),
      )
        .setOrigin(0.5, 0)
        .setDepth(60),
    );
    this.round++;
    // Time to read the reason: longer reasons stay up longer.
    this.time.delayedCall(Math.min(5000, 2000 + q.why.length * 25), () => this.ask());
  }

  protected lesson() {
    // One line a kid can read. Record types and routing policies live in the Route 53 flashcards.
    return 'DNS is the city’s phone book: it turns names into addresses.';
  }
}
