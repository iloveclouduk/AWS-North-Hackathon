import Phaser from 'phaser';
import type { Tile } from '@/world/layout';
import { Agent, type AgentWorld } from './Agent';
import { crowdSheet, hasAnim } from './assets';

/** A discovered service's place in the city: where its workers clock in, and the services it works with. */
export interface WorkerPost {
  serviceId: string;
  /** The worker's name tag, e.g. "Lambda team". */
  name: string;
  workSpot: Tile;
  /** Work spots of the services it integrates with here (shared/flows.json): where its workers go on errands. */
  partners: () => Tile[];
}

/** Workers on the street at once, per surface: a share of the crowd, so the total stays inside the citizen cap. */
export const WORKER_CAP = { panel: 4, tab: 8 } as const;
/** How long a worker stays at a building before the next errand, ms. */
const DWELL_MS = 6000;

/**
 * Each discovered service's workers, dressed as its agent (the crowd-size copy of its sheet): they walk between their
 * own building and the ones their service works with (Lambda ⇄ API Gateway, DynamoDB ⇄ Lambda…), so the crowd shows
 * how AWS fits together. Tapping one calls `onTap` (the scene opens the building and the worker shares a tip).
 * Movement is rule-driven: no model call ever comes from walking.
 */
export class Workers {
  readonly list: Agent[] = [];
  private posts = new Map<Agent, WorkerPost>();
  private nextErrand = new Map<Agent, number>();

  constructor(
    private scene: Phaser.Scene,
    private world: AgentWorld,
    private onTap: (serviceId: string, worker: Agent) => void,
  ) {}

  /** One worker per post, in order, up to `cap`; posts that went away (another Region) take their workers with them. */
  sync(posts: WorkerPost[], cap: number) {
    const want = posts.slice(0, cap);
    for (const w of [...this.list]) {
      const post = this.posts.get(w)!;
      if (!want.some((p) => p.serviceId === post.serviceId)) this.drop(w);
    }
    for (const post of want) {
      if (this.list.some((w) => this.posts.get(w)!.serviceId === post.serviceId)) continue;
      const sheet = crowdSheet(post.serviceId);
      if (sheet === post.serviceId || !hasAnim(sheet, 'walk')) continue; // no crowd copy drawn for it: no worker
      const w = new Agent(this.scene, this.world, {
        id: `worker:${post.serviceId}`,
        sheet,
        name: post.name,
        tile: post.workSpot,
        home: { x: post.workSpot.x - 3, y: post.workSpot.y - 3, w: 7, h: 7 },
        workSpot: post.workSpot,
        speed: 1.6 + Math.random() * 0.4,
        wanders: false,
      });
      w.onClick(() => this.onTap(post.serviceId, w));
      this.list.push(w);
      this.posts.set(w, post);
      this.nextErrand.set(w, 0);
    }
  }

  update(time: number, dt: number) {
    for (const w of this.list) {
      w.update(time, dt);
      if (w.isBusy || time < (this.nextErrand.get(w) ?? 0)) continue;
      const post = this.posts.get(w)!;
      // Errands alternate: out to a partner service, then back to their own building.
      const atHome = Math.abs(w.gx - post.workSpot.x) + Math.abs(w.gy - post.workSpot.y) <= 1;
      const partners = post.partners();
      const to = atHome && partners.length ? partners[Math.floor(Math.random() * partners.length)] : post.workSpot;
      this.nextErrand.set(w, time + DWELL_MS + Math.random() * DWELL_MS);
      w.pin(true);
      w.goTo(to, () => {
        w.emote('talk', 2400);
        w.pin(false);
      });
    }
  }

  setUiScale(s: number) {
    for (const w of this.list) w.setUiScale(s);
  }

  destroy() {
    for (const w of [...this.list]) this.drop(w);
  }

  private drop(w: Agent) {
    this.list.splice(this.list.indexOf(w), 1);
    this.posts.delete(w);
    this.nextErrand.delete(w);
    w.destroy();
  }
}
