import Phaser from 'phaser';
import { BENCHES, GRID, type Tile } from '@/world/layout';
import { Agent, type AgentWorld } from './Agent';
import { roleForSheet } from '@/world/culture';
import { citizenIds, crowdSheet } from './assets';
import { click } from './audio';

import { citizenLines, REPLIES, type ChatContext } from '@/world/dialogue';

/** Pedestrians that make the city feel alive. They never block agents or the player. */
export class Citizens {
  readonly list: Agent[] = [];
  private nextThink = 0;
  private waved = new WeakMap<Agent, number>();
  private benchTaken = new Map<string, Agent>();
  private roles = new Map<Agent, string[]>();

  constructor(
    private scene: Phaser.Scene,
    private world: AgentWorld,
    private spawnTiles: () => Tile[],
    private extras: { lakeShore: () => Tile | undefined; player: () => Agent | undefined; context?: () => ChatContext },
  ) {}

  /** Keep roughly `target` citizens in town (grows as the city grows). */
  ensure(target: number) {
    const ids = citizenIds();
    const tiles = this.spawnTiles();
    while (this.list.length < target && tiles.length) {
      const t = tiles[Math.floor(Math.random() * tiles.length)];
      const n = this.list.length;
      const sheet = ids[n % ids.length];
      // Amazonians (SDE, SA, TAM, SRE, PM, delivery and warehouse associates) wear name tags with their role.
      const role = roleForSheet(sheet);
      const a = new Agent(this.scene, this.world, {
        id: `cz${n}`,
        sheet: crowdSheet(sheet),
        name: role ? `${role.names[Math.floor(n / ids.length) % role.names.length]} · ${role.short}` : 'Citizen',
        tile: t,
        home: { x: 0, y: 0, w: GRID, h: GRID },
        speed: 1.3 + Math.random() * 0.6,
      });
      if (role) {
        this.roles.set(a, role.lines);
        a.onClick(() => {
          click();
          const p = this.extras.player();
          if (p) a.face(p.tile);
          a.emote('wave', 1200);
          a.say(`${role.title}: ${role.lines[Math.floor(Math.random() * role.lines.length)]}`, { holdMs: 3500 });
        });
      } else a.sprite.disableInteractive();
      this.list.push(a);
    }
  }

  /** Down to `cap` citizens (the window narrowed to a panel's width): idle ones leave; busy ones finish first. */
  trim(cap: number) {
    for (let i = this.list.length - 1; i >= 0 && this.list.length > cap; i--) {
      const c = this.list[i];
      if (c.isBusy) continue;
      this.list.splice(i, 1);
      this.roles.delete(c);
      c.destroy();
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
    // Amazonians talk shop (their role's lines); everyone else talks about the moment: the hour, a storm, the city.
    const lines = this.roles.get(c) ?? citizenLines(this.extras.context?.() ?? { hour: new Date().getHours(), openFindings: 0, level: 0 });
    // The words show only with the chatter setting on (and nobody else talking); the talking and laughing always do.
    const spoke = c.say(lines[Math.floor(Math.random() * lines.length)], { holdMs: 1500, priority: 'ambient' });
    this.scene.time.delayedCall(1300, () => {
      if (!this.list.includes(other)) return; // left the city (trim) meanwhile
      other.emote(Math.random() < 0.5 ? 'laugh' : 'talk', 1800, other.dir);
      // The reply belongs to a line that showed (its bubble is still up, so it can't pass the ambient gate itself).
      if (spoke) other.say(REPLIES[Math.floor(Math.random() * REPLIES.length)], { holdMs: 1400 });
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
