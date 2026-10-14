import Phaser from 'phaser';
import type { CityFinding } from '@/backend/contract';
import { CITIZENS, citizenSheet, citizenTag, type CitizenDef } from '@/world/citizens';
import { DISTRICT_PLOTS, landmarkLayout, TOWN_SQUARE, type Rect, type Tile } from '@/world/layout';
import type { DistrictId } from '@/world/taxonomy';
import { Agent, type AgentWorld } from './Agent';
import { characterIndex, citizenIds, crowdSheet } from './assets';

interface Patroller {
  def: CitizenDef;
  agent: Agent;
  /** Open findings still to visit, oldest first. */
  queue: string[];
  /** The finding being walked to or stood at. */
  visiting?: string;
  arrived?: boolean;
  nextMove: number;
}

export interface PatrolHooks {
  /** Districts the player has unlocked (citizens only patrol those). */
  unlocked(): DistrictId[];
  /** Where a citizen may stand while patrolling (sidewalks). */
  wanderable(x: number, y: number): boolean;
  finding(id: string): CityFinding | undefined;
  onClick(citizenId: string): void;
}

/** How long a citizen stays at a finding before walking back to patrol (the marker stays). */
const STAY_MS = 9000;

/**
 * The six citizens who look after the city (shared/citizens.json), one per Well-Architected pillar. They patrol
 * the unlocked districts they care for; when a finding opens, its citizen walks to the landmark, says what's
 * wrong and waits a moment for you, then goes back to patrolling.
 */
export class Patrols {
  private list: Patroller[] = [];

  constructor(
    private scene: Phaser.Scene,
    private world: AgentWorld,
    private hooks: PatrolHooks,
  ) {
    const generic = citizenIds();
    for (const def of CITIZENS) {
      const sheet = citizenSheet(def, (s) => !!characterIndex()[s], generic);
      if (!sheet) continue;
      const agent = new Agent(scene, world, {
        id: def.id,
        sheet: crowdSheet(sheet),
        name: citizenTag(def),
        tagName: def.name,
        tile: this.randomTile(this.areaFor(def)) ?? { x: TOWN_SQUARE.rect.x + 6, y: TOWN_SQUARE.rect.y + 10 },
        home: TOWN_SQUARE.rect,
        speed: 1.9,
        wanders: false,
        showTag: false,
      });
      agent.onClick(() => hooks.onClick(def.id));
      this.list.push({ def, agent, queue: [], nextMove: scene.time.now + 800 + Math.random() * 2500 });
    }
  }

  agent(citizenId: string) {
    return this.byId(citizenId)?.agent;
  }

  private byId(citizenId: string) {
    return this.list.find((p) => p.def.id === citizenId);
  }

  /** A finding opened: its citizen will walk over (after any it is already visiting). */
  raise(f: CityFinding) {
    const p = this.byId(f.citizenId);
    if (!p || p.visiting === f.id || p.queue.includes(f.id)) return;
    p.queue.push(f.id);
  }

  /** A finding resolved: cheer if standing there, stop walking there otherwise. */
  resolve(f: CityFinding, fixed: boolean) {
    const p = this.byId(f.citizenId);
    if (!p) return;
    p.queue = p.queue.filter((id) => id !== f.id);
    if (p.visiting !== f.id) {
      if (fixed) p.agent.say('Fixed. Thank you for the OK!', { tone: 'done', holdMs: 3000 });
      return;
    }
    p.agent.say(fixed ? 'Fixed. Thank you for the OK!' : 'All clear here now.', { tone: 'done', holdMs: 3000 });
    if (p.arrived) {
      p.agent.emote('jump', 1200);
      this.scene.time.delayedCall(2500, () => p.visiting === f.id && this.leave(p));
    } else this.leave(p);
  }

  /** The backend says a real AWS call runs for this citizen (agent.state). */
  setWorking(citizenId: string, on: boolean, detail?: string) {
    const p = this.byId(citizenId);
    if (!p) return;
    p.agent.setDetail(on ? detail : undefined);
    if (on && !p.agent.isBusy) p.agent.hold('talk', p.agent.dir);
    else if (!on) p.agent.release();
  }

  levelUp(citizenId: string, text: string) {
    const p = this.byId(citizenId);
    if (!p) return;
    p.agent.say(text, { tone: 'done', caption: 'Level up' });
    p.agent.emote('jump', 1400);
  }

  update(time: number, dt: number) {
    for (const p of this.list) {
      p.agent.update(time, dt);
      if (!p.visiting && p.queue.length) this.visit(p, p.queue.shift()!);
      else if (!p.visiting && !p.agent.isBusy && time > p.nextMove) this.patrol(p, time);
    }
  }

  /** Name tags at rest (the scene's label budget: from zoom 2); hover always shows the name and pillar. */
  setTagsShown(on: boolean) {
    for (const p of this.list) p.agent.setTagShown(on);
  }

  setUiScale(s: number) {
    for (const p of this.list) p.agent.setUiScale(s);
  }

  /** Where a citizen patrols: its unlocked districts, else the town square. */
  private areaFor(def: CitizenDef): Rect {
    const open = this.hooks.unlocked();
    const mine = def.districts.filter((d) => open.includes(d));
    return mine.length ? DISTRICT_PLOTS[mine[Math.floor(Math.random() * mine.length)]].rect : TOWN_SQUARE.rect;
  }

  private randomTile(r: Rect): Tile | undefined {
    for (let i = 0; i < 30; i++) {
      const t = { x: r.x + Math.floor(Math.random() * r.w), y: r.y + Math.floor(Math.random() * r.h) };
      if (this.world.walkable(t.x, t.y) && this.hooks.wanderable(t.x, t.y)) return t;
    }
    return undefined;
  }

  private patrol(p: Patroller, time: number) {
    p.nextMove = time + 6000 + Math.random() * 7000;
    const t = this.randomTile(this.areaFor(p.def));
    if (t) p.agent.goTo(t);
  }

  /** Next to the landmark's work spot, so the citizen doesn't stand on its agent. */
  private standSpot(serviceId: string): Tile | undefined {
    const w = landmarkLayout(serviceId)?.workSpot;
    if (!w) return undefined;
    for (const [dx, dy] of [[1, 0], [-1, 0], [1, 1], [-1, 1], [0, 1], [0, 0]]) {
      const t = { x: w.x + dx, y: w.y + dy };
      if (this.world.walkable(t.x, t.y)) return t;
    }
    return w;
  }

  private visit(p: Patroller, findingId: string) {
    const f = this.hooks.finding(findingId);
    const spot = f?.status === 'open' ? this.standSpot(f.serviceId) : undefined;
    if (!f || !spot) return;
    p.visiting = f.id;
    p.arrived = false;
    p.agent.release();
    p.agent.pin(true);
    p.agent.goTo(spot, () => {
      if (p.visiting !== f.id) return;
      p.arrived = true;
      const l = landmarkLayout(f.serviceId);
      if (l) p.agent.face({ x: l.footprint.x + Math.floor(l.footprint.w / 2), y: l.footprint.y + Math.floor(l.footprint.h / 2) });
      p.agent.emote('hi', 1400);
      p.agent.say('I spotted a problem. Tap me!', { tone: 'alert', priority: 'alert', holdMs: 4000 });
      this.scene.time.delayedCall(STAY_MS, () => p.visiting === f.id && this.leave(p));
    });
  }

  private leave(p: Patroller) {
    p.visiting = undefined;
    p.arrived = false;
    p.agent.pin(false);
    p.nextMove = 0;
  }
}
