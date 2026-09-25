import Phaser from 'phaser';
import { FRAME_H, FRAME_W, PIVOT, citizenIds } from '../../assets';
import { MiniGame, TXT } from './MiniGame';

interface Q {
  q: string;
  options: string[];
  answer: string;
  why: string;
}

const QUESTIONS: Q[] = [
  { q: 'Point www.example.com at the IPv4 address 203.0.113.10', options: ['A', 'AAAA', 'MX', 'TXT'], answer: 'A', why: 'An A record maps a name to an IPv4 address.' },
  { q: 'Point api.example.com at an IPv6 address', options: ['A', 'AAAA', 'CNAME', 'MX'], answer: 'AAAA', why: 'AAAA records hold IPv6 addresses.' },
  { q: 'Route email for example.com to the mail servers', options: ['MX', 'A', 'TXT', 'NS'], answer: 'MX', why: 'MX records say which servers accept mail for a domain.' },
  { q: 'Prove you own the domain with a verification string', options: ['TXT', 'MX', 'CNAME', 'A'], answer: 'TXT', why: 'TXT records carry arbitrary text such as verification tokens and SPF.' },
  { q: 'Make blog.example.com another name for myblog.host.net', options: ['CNAME', 'A', 'AAAA', 'MX'], answer: 'CNAME', why: 'A CNAME makes one name an alias of another name (not allowed at the zone apex).' },
  { q: 'Point the zone apex example.com at a CloudFront distribution', options: ['Alias', 'CNAME', 'MX', 'TXT'], answer: 'Alias', why: 'Route 53 alias records can point the apex at AWS resources like CloudFront — a CNAME can’t sit at the apex.' },
  { q: 'Send London users to eu-west-2 and New York users to us-east-1', options: ['Latency', 'Weighted', 'Failover', 'Simple'], answer: 'Latency', why: 'Latency-based routing sends users to the Region with the lowest latency for them.' },
  { q: 'Canary release: 90% of traffic to v1, 10% to v2', options: ['Weighted', 'Latency', 'Geolocation', 'Failover'], answer: 'Weighted', why: 'Weighted routing splits traffic by the weights you assign.' },
  { q: 'Serve a backup site only when the primary fails its health check', options: ['Failover', 'Weighted', 'Simple', 'Latency'], answer: 'Failover', why: 'Failover routing uses health checks to switch to a secondary.' },
  { q: 'Show German users the German site based on where they are', options: ['Geolocation', 'Latency', 'Weighted', 'Multivalue'], answer: 'Geolocation', why: 'Geolocation routing answers based on the user’s location (country/continent).' },
];

/** Route 53 Dance Hall: every dancer asks a DNS question — call the right record type or routing policy. */
export class DanceGame extends MiniGame {
  private round = 0;
  private deck: Q[] = [];
  private ui: Phaser.GameObjects.GameObject[] = [];
  private dancers: Phaser.GameObjects.Sprite[] = [];

  constructor() {
    super('game:route53', 'route53', 'route53', '💃 Route 53 Dance Hall — call the right DNS answer');
    this.duration = 0;
  }

  protected setup() {
    this.round = 0;
    this.dancers = [];
    this.deck = Phaser.Utils.Array.Shuffle([...QUESTIONS]).slice(0, 8);
    const { width: w, height: h } = this.scale;
    const g = this.add.graphics();
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 16; x++) g.fillStyle((x + y) % 2 ? 0x4c1d95 : 0x6d28d9, 1).fillRect((x * w) / 16, h * 0.55 + (y * h * 0.45) / 8, w / 16 + 1, (h * 0.45) / 8 + 1);
    g.fillStyle(0x1e1b4b, 1).fillRect(0, 0, w, h * 0.55);
    for (let i = 0; i < 12; i++) this.add.circle(Math.random() * w, Math.random() * h * 0.5, 2, [0xf472b6, 0xfde047, 0x60a5fa][i % 3]);
    const ids = citizenIds();
    // Ruby the caller
    this.add.sprite(w / 2, h * 0.62, 'char:route53', 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H).setScale(2).play('route53:dance:SE');
    for (let i = 0; i < 8; i++) {
      const s = this.add.sprite(40 + ((w - 80) * i) / 7, h * 0.95, `char:${ids[i % ids.length]}`, 0).setOrigin(PIVOT.x / FRAME_W, PIVOT.y / FRAME_H).setScale(1.5);
      s.play(`${ids[i % ids.length]}:idle:SE`);
      this.dancers.push(s);
    }
    this.ask();
  }

  private ask() {
    for (const o of this.ui) o.destroy();
    this.ui = [];
    if (this.round >= this.deck.length) return this.finish();
    const q = this.deck[this.round];
    const { width: w, height: h } = this.scale;
    this.ui.push(
      this.add.text(w / 2, h * 0.1, `Dancer ${this.round + 1}/8 asks:`, TXT(16, '#c4b5fd')).setOrigin(0.5),
      this.add.text(w / 2, h * 0.18, `“${q.q}”`, { ...TXT(16, '#ffffff'), align: 'center', wordWrap: { width: w - 40 } }).setOrigin(0.5, 0),
    );
    const opts = Phaser.Utils.Array.Shuffle([...q.options]);
    opts.forEach((o, i) => {
      const x = w / 2 + (i - (opts.length - 1) / 2) * Math.min(110, (w - 20) / opts.length);
      const b = this.add.text(x, h * 0.38, o, { ...TXT(16, '#ffffff'), backgroundColor: '#7c3aed', padding: { x: 10, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => this.answer(q, o));
      this.ui.push(b);
    });
  }

  private answer(q: Q, o: string) {
    const { width: w, height: h } = this.scale;
    const ok = o === q.answer;
    this.addScore(ok ? 15 : 0);
    const d = this.dancers[this.round];
    const id = (d.texture.key as string).replace('char:', '');
    d.play(`${id}:${ok ? 'dance' : 'laugh'}:SE`);
    for (const x of this.ui) (x as Phaser.GameObjects.Text).disableInteractive?.();
    this.ui.push(this.add.text(w / 2, h * 0.46, `${ok ? '✅' : '❌ ' + q.answer + ' —'} ${q.why}`, { ...TXT(16, ok ? '#86efac' : '#fca5a5'), align: 'center', wordWrap: { width: w - 40 } }).setOrigin(0.5, 0));
    this.round++;
    this.time.delayedCall(2200, () => this.ask());
  }

  protected lesson() {
    return 'Record types: A (IPv4), AAAA (IPv6), CNAME (name→name, not at apex), MX (mail), TXT (text/verification), Alias (Route 53 extension for AWS targets, works at the apex). Routing policies: simple, weighted, latency, failover, geolocation, geoproximity, multivalue.';
  }
}
