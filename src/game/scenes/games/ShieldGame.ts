import { MiniGame, pace, TXT } from './MiniGame';
import { reducedMotion } from '../../motion';
import { crisp } from '../../SpeechBubble';
import { useCity } from '@/state/store';
import { SHIELD, tierFor, type Attack, type WafRule } from '@/world/minigames';

type Kind = 'good' | 'flood' | 'l7';
/** A new wave every this many seconds: traffic comes faster and moves quicker. */
const WAVE_S = 15;

/**
 * Shield Wall: Shield Standard absorbs volumetric floods (L3/L4) automatically, so you don't click those.
 * Application-layer (L7) attacks need AWS WAF rules: click them before they reach the castle. Never block real users.
 * Each block names the rule that would catch it; the lesson at the end counts what you stopped.
 */
export class ShieldGame extends MiniGame {
  private attacks: Attack[] = [];
  private stopped: Partial<Record<WafRule, number>> = {};
  private wave = 0;
  private started = 0;

  constructor() {
    super('game:shield', 'shield', 'shield', '🛡️ Shield Wall — click red L7 attacks or press Space (WAF); let green users in');
  }

  protected setup() {
    this.attacksLive = [];
    this.onKeys((k) => (k === ' ' || k.startsWith('Arrow')) && this.strikeNearest());
    const { width: w, height: h } = this.scale;
    const g = this.add.graphics();
    // night sky in bands, a few stars
    const sky = [0x0f172a, 0x131c33, 0x17213c, 0x1b2745];
    sky.forEach((c, i) => g.fillStyle(c, 1).fillRect(0, (i * h * 0.72) / sky.length, w, (h * 0.72) / sky.length + 1));
    for (let i = 0; i < 24; i++) g.fillStyle(0xffffff, 0.3 + (i % 3) * 0.2).fillRect((i * 97) % w, this.top + ((i * 53) % Math.max(1, h * 0.25)), 2, 2);
    // the internet road the traffic travels along
    g.fillStyle(0x334155, 1).fillRect(0, h * 0.27, w, h * 0.45);
    for (let x = 90; x < w; x += 40) g.fillStyle(0x475569, 1).fillRect(x, h * 0.495, 20, 3);
    g.fillStyle(0x1e293b, 1).fillRect(0, h * 0.72, w, h);
    g.fillStyle(0x3f9b4f, 1).fillRect(0, h * 0.72, w, 6);
    // castle: wall, battlements, gate
    const cx = 0;
    const cw = 76;
    g.fillStyle(0x94a3b8, 1).fillRect(cx, h * 0.22, cw, h * 0.52);
    for (let x = cx; x < cx + cw; x += 16) g.fillStyle(0x94a3b8, 1).fillRect(x, h * 0.22 - 10, 10, 10);
    for (let y = h * 0.24; y < h * 0.74; y += 14) for (let x = cx + ((y / 14) % 2) * 8; x < cx + cw; x += 18) g.fillStyle(0x7c8aa0, 1).fillRect(x, y, 14, 2);
    g.fillStyle(0x3b2414, 1).fillRect(cx + 26, h * 0.56, 26, h * 0.18);
    g.fillStyle(0x000000, 1).fillRect(cx, h * 0.22 - 10, 2, h * 0.54);
    crisp(this.add.text(cx + cw / 2, h * 0.22 - 22, 'your app', { ...TXT(14, '#e2e8f0'), backgroundColor: '#140d1fcc', padding: { x: 5, y: 1 } })).setOrigin(0.5);
    // the shield (Shield Standard): always on, absorbs floods
    this.add.ellipse(cw + 8, h * 0.48, 56, h * 0.58, 0x60a5fa, 0.14).setStrokeStyle(3, 0x60a5fa, 0.7);
    crisp(this.add.text(w / 2, h - 18, '🔵 floods: leave them to Shield   🔴 click L7 attacks (or Space)   🟢 let real users in', { ...TXT(14, '#cbd5e1'), backgroundColor: '#140d1fcc', padding: { x: 6, y: 2 } })).setOrigin(0.5);
    const plays = useCity.getState().progress.games?.shield?.plays ?? 0;
    this.attacks = SHIELD.attacks.filter((a) => a.tier <= tierFor(plays));
    this.stopped = {};
    this.wave = 0;
    this.started = this.time.now;
    this.scheduleSpawn();
  }

  /** The next arrival: sooner each wave (900 ms apart at first, 500 ms by the third wave). */
  private scheduleSpawn() {
    if (this.over) return;
    const wave = Math.floor((this.time.now - this.started) / 1000 / WAVE_S);
    if (wave > this.wave) {
      this.wave = wave;
      const { width: w, height: h } = this.scale;
      this.floater(w / 2, h * 0.2, `Wave ${wave + 1}: they're getting faster`, '#fde047');
    }
    this.time.delayedCall(pace(Math.max(500, 900 - this.wave * 200)), () => {
      if (this.over) return;
      this.spawn();
      this.scheduleSpawn();
    });
  }

  /** Layer 7 attacks on the road now (the keyboard stops the one nearest the wall). */
  private attacksLive: Phaser.GameObjects.Text[] = [];

  /** Space or an arrow key: stop the sneaky attack closest to the castle, as a click on it would. */
  private strikeNearest() {
    const t = this.attacksLive.reduce<Phaser.GameObjects.Text | undefined>((a, b) => (!a || b.x < a.x ? b : a), undefined);
    if (t) t.emit('pointerdown');
    else this.floater(110, this.scale.height * 0.4, 'no sneaky attack yet', '#93c5fd');
  }

  private spawn() {
    const FLOODS = ['SYN SYN SYN', 'UDP UDP UDP', 'ACK ACK ACK', 'DNS reflect'];
    const { width: w, height: h } = this.scale;
    const r = Math.random();
    const kind: Kind = r < 0.4 ? 'good' : r < 0.6 ? 'flood' : 'l7';
    const y = h * 0.3 + Math.random() * h * 0.38;
    const attack = kind === 'l7' ? this.attacks[Math.floor(Math.random() * this.attacks.length)] : undefined;
    // Floods are network and transport layer (layer 3/4) attacks, which Shield Standard absorbs; layer 7 is WAF's job.
    const label = kind === 'good' ? SHIELD.good[Math.floor(Math.random() * SHIELD.good.length)] : attack ? attack.label : FLOODS[Math.floor(Math.random() * FLOODS.length)];
    const color = kind === 'good' ? '#86efac' : kind === 'l7' ? '#fca5a5' : '#93c5fd';
    const t = crisp(this.add.text(w + 10, y, label, { ...TXT(16, color), backgroundColor: '#0f172ae6', padding: { x: 5, y: 2 } })).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    if (kind === 'l7') {
      this.attacksLive.push(t);
      t.once('destroy', () => (this.attacksLive = this.attacksLive.filter((x) => x !== t)));
    }
    const quicken = 1 - Math.min(0.35, this.wave * 0.15);
    const speed = (kind === 'flood' ? 5200 : 6500 + Math.random() * 1500) * quicken;
    const tw = this.tweens.add({
      targets: t,
      x: 80,
      duration: pace(speed),
      onComplete: () => {
        if (this.over) return t.destroy();
        if (kind === 'flood') {
          this.floater(110, y, 'absorbed by Shield', '#93c5fd');
          this.tweens.add({ targets: t, x: w * 0.4, alpha: 0, duration: 400, onComplete: () => t.destroy() });
          return;
        }
        if (kind === 'good') this.addScore(2, 'none');
        else {
          this.addScore(-5, 'soft');
          this.floater(110, y, 'breach!', '#fca5a5');
          if (!reducedMotion()) this.cameras.main.shake(120, 0.004);
        }
        t.destroy();
      },
    });
    t.on('pointerdown', () => {
      if (this.over) return;
      tw.stop();
      if (kind === 'l7' && attack) {
        this.addScore(10);
        this.stopped[attack.rule] = (this.stopped[attack.rule] ?? 0) + 1;
        this.floater(t.x, y, `${SHIELD.rules[attack.rule].name} ✓`, '#fde047');
      } else if (kind === 'good') {
        this.addScore(-5);
        this.floater(t.x, y, 'blocked a real user!', '#fca5a5');
      } else {
        // A flood is Shield's: clicking it wastes the defender's time (the lesson is "let Shield absorb it").
        this.addScore(-2);
        this.floater(t.x, y, 'Shield had this one: let floods through', '#93c5fd');
      }
      t.destroy();
    });
  }

  protected lesson() {
    // One line a kid can read. Shield Standard, WAF and Shield Advanced are in the Shield flashcards.
    const caught = Object.values(this.stopped).reduce((a, n) => a + (n ?? 0), 0);
    const tally = caught ? `You stopped ${caught} sneaky attack${caught === 1 ? '' : 's'}! ` : '';
    return `${tally}Shield blocks big floods for free; WAF rules catch the sneaky ones.`;
  }
}
