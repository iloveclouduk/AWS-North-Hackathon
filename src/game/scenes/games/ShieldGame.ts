import Phaser from 'phaser';
import { MiniGame, TXT } from './MiniGame';

type Kind = 'good' | 'flood' | 'l7';
const L7 = ["' OR 1=1 --", '<script>', 'bad-bot/1.0', '../../etc/passwd', 'SELECT * FROM'];
const GOOD = ['GET /home', 'GET /shop', 'POST /cart', 'GET /img.png', 'GET /api/me'];

/**
 * Shield Wall: Shield Standard absorbs volumetric floods (L3/L4) automatically — you don't click those.
 * Layer-7 attacks need WAF rules: click them before they reach the castle. Never block real users.
 */
export class ShieldGame extends MiniGame {
  constructor() {
    super('game:shield', 'shield', 'shield', '🛡️ Shield Wall — block the L7 attacks (WAF), let users in');
  }

  protected setup() {
    const { width: w, height: h } = this.scale;
    const g = this.add.graphics();
    g.fillStyle(0x1e293b, 1).fillRect(0, 0, w, h);
    g.fillStyle(0x334155, 1).fillRect(0, h * 0.72, w, h);
    // castle
    g.fillStyle(0x94a3b8, 1).fillRect(0, h * 0.25, 70, h * 0.5);
    for (let y = h * 0.25; y < h * 0.75; y += 24) g.fillStyle(0x64748b, 1).fillRect(56, y, 14, 12);
    g.fillStyle(0xd64545, 1).fillRect(20, h * 0.42, 24, 30);
    this.add.text(35, h * 0.25 - 18, 'your app', TXT(16, '#cbd5e1')).setOrigin(0.5);
    // shield bubble (Shield Standard)
    this.add.ellipse(80, h * 0.5, 60, h * 0.6, 0x60a5fa, 0.15).setStrokeStyle(2, 0x60a5fa, 0.6);
    this.add.text(w / 2, h - 22, 'Blue floods bounce off Shield · click red L7 attacks · green = real users', TXT(16, '#94a3b8')).setOrigin(0.5);
    this.time.addEvent({ delay: 650, loop: true, callback: () => !this.over && this.spawn() });
  }

  private spawn() {
    const { width: w, height: h } = this.scale;
    const r = Math.random();
    const kind: Kind = r < 0.4 ? 'good' : r < 0.65 ? 'flood' : 'l7';
    const y = h * 0.3 + Math.random() * h * 0.38;
    const label = kind === 'good' ? GOOD[Math.floor(Math.random() * GOOD.length)] : kind === 'l7' ? L7[Math.floor(Math.random() * L7.length)] : 'SYN SYN SYN';
    const color = kind === 'good' ? '#86efac' : kind === 'l7' ? '#fca5a5' : '#93c5fd';
    const t = this.add.text(w + 10, y, label, { ...TXT(16, color), backgroundColor: '#0f172acc', padding: { x: 3, y: 0 } }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    const speed = kind === 'flood' ? 5200 : 6500 + Math.random() * 1500;
    const tw = this.tweens.add({
      targets: t,
      x: 80,
      duration: speed,
      onComplete: () => {
        if (this.over) return t.destroy();
        if (kind === 'flood') {
          this.floater(110, y, 'absorbed by Shield', '#93c5fd');
          this.tweens.add({ targets: t, x: w * 0.4, alpha: 0, duration: 400, onComplete: () => t.destroy() });
          return;
        }
        if (kind === 'good') this.addScore(2);
        else {
          this.addScore(-5);
          this.floater(110, y, 'breach!', '#fca5a5');
          this.cameras.main.shake(120, 0.004);
        }
        t.destroy();
      },
    });
    t.on('pointerdown', () => {
      if (this.over) return;
      tw.stop();
      if (kind === 'l7') {
        this.addScore(10);
        this.floater(t.x, y, 'WAF rule ✓', '#fde047');
      } else if (kind === 'good') {
        this.addScore(-5);
        this.floater(t.x, y, 'blocked a real user!', '#fca5a5');
      } else {
        this.floater(t.x, y, 'Shield has this one', '#93c5fd');
      }
      t.destroy();
    });
  }

  protected lesson() {
    return 'AWS Shield Standard automatically protects against common network-layer (L3/L4) floods at no extra cost. Application-layer (L7) attacks like SQL injection, XSS and bad bots need AWS WAF rules. Shield Advanced adds DDoS response support and cost protection.';
  }
}
