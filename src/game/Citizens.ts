import Phaser from 'phaser';
import { BENCHES, GRID, type Tile } from '@/world/layout';
import { Agent, type AgentWorld } from './Agent';
import { citizenIds } from './assets';

const CHATTER = ['Hi!', 'Nice day for a deploy!', 'Have you seen the S3 Lake?', 'I just learned about IAM roles!', 'Lambda cooks the best events.', 'Serverless is so relaxing.', 'Did you check CloudWatch?', 'Coffee at ElastiCache Café?', 'Multi-AZ or bust!', 'Least privilege, always.'];

/** Pedestrians that make the city feel alive. They never block agents or the player. */
export class Citizens {
  readonly list: Agent[] = [];
  private nextThink = 0;
  private waved = new WeakMap<Agent, number>();
  private benchTaken = new Map<string, Agent>();

  constructor(
    private scene: Phaser.Scene,
    private world: AgentWorld,
    private spawnTiles: () => Tile[],
    private extras: { lakeShore: () => Tile | undefined; player: () => Agent | undefined },
  ) {}

  /** Keep roughly `target` citizens in town (grows as the city grows). */
  ensure(target: number) {
    const ids = citizenIds();
    const tiles = this.spawnTiles();
    while (this.list.length < target && tiles.length) {
      const t = tiles[Math.floor(Math.random() * tiles.length)];
      const sheet = ids[this.list.length % ids.length];
      const a = new Agent(this.scene, this.world, {
        id: `cz${this.list.length}`,
        sheet,
        name: 'Citizen',
        tile: t,
        home: { x: 0, y: 0, w: GRID, h: GRID },
        speed: 1.3 + Math.random() * 0.6,
      });
      a.sprite.disableInteractive();
      this.list.push(a);
    }
  }

  update(time: number, dt: number) {
    for (const c of this.list) c.update(time, dt);
    const player = this.extras.player();
    if (player) {
      for (const c of this.list) {
        if (c.isBusy) continue;
        const d = Math.abs(c.gx - player.gx) + Math.abs(c.gy - player.gy);
        if (d <= 2 && time - (this.waved.get(c) ?? -1e9) > 20_000) {
          this.waved.set(c, time);
          c.face(player.tile);
          c.emote(Math.random() < 0.5 ? 'wave' : 'hi', 1600);
        }
      }
    }
    if (time < this.nextThink) return;
    this.nextThink = time + 1200;
    const idle = this.list.filter((c) => !c.isBusy);
    const c = idle[Math.floor(Math.random() * idle.length)];
    if (!c) return;
    const roll = Math.random();
    if (roll < 0.2) this.sitOnBench(c);
    else if (roll < 0.4) this.chat(c, idle);
    else if (roll < 0.52) this.fish(c);
    else if (roll < 0.58) c.emote('drink', 2400);
    else if (roll < 0.62) c.emote('dance', 2400);
  }

  private sitOnBench(c: Agent) {
    const free = BENCHES.filter((b) => !this.benchTaken.has(`${b.x},${b.y}`));
    const b = free[Math.floor(Math.random() * free.length)];
    if (!b) return;
    const k = `${b.x},${b.y}`;
    this.benchTaken.set(k, c);
    c.pin(true);
    c.goTo(b, () => {
      c.hold('sit', 'SE');
      this.scene.time.delayedCall(6000 + Math.random() * 8000, () => {
        c.release();
        c.pin(false);
        this.benchTaken.delete(k);
      });
    });
  }

  private chat(c: Agent, idle: Agent[]) {
    const other = idle.find((o) => o !== c && Math.abs(o.gx - c.gx) + Math.abs(o.gy - c.gy) <= 4);
    if (!other) return;
    c.face(other.tile);
    other.face(c.tile);
    c.emote('talk', 2200, c.dir);
    c.say(CHATTER[Math.floor(Math.random() * CHATTER.length)], { holdMs: 1500 });
    this.scene.time.delayedCall(1300, () => {
      other.emote(Math.random() < 0.5 ? 'laugh' : 'talk', 1800, other.dir);
      other.say(['Ha! Totally.', 'Same!', 'Tell me more!', 'Nice!', 'On my way.'][Math.floor(Math.random() * 5)], { holdMs: 1400 });
    });
  }

  private fish(c: Agent) {
    const shore = this.extras.lakeShore();
    if (!shore) return;
    c.pin(true);
    c.goTo(shore, () => {
      c.hold('fish', 'NE');
      this.scene.time.delayedCall(8000 + Math.random() * 6000, () => {
        c.release();
        c.pin(false);
      });
    });
  }

  setUiScale(s: number) {
    for (const c of this.list) c.setUiScale(s);
  }
}
