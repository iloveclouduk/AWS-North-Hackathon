import type { Tile } from '@/world/layout';
import { hasSprite } from './assets';
import { rand } from './rng';
import type { Traffic } from './Traffic';

/** Vans on the roads at once, at most. */
const MAX_VANS = 2;
const UNLOAD_MS = 2500;

/**
 * Amazon.com delivery vans, a route role in the city's traffic: in from the highway (the Region's way in), along the
 * roads to the fulfilment centre, a stop to unload, and back out the way they came. Decoration only: they share the
 * roads with the cars, block no one on foot, and don't stand for AWS activity.
 */
export class Vans {
  private wait = 6000;
  private active = 0;

  constructor(
    private traffic: Traffic,
    private dock: Tile | undefined,
  ) {}

  /** Per frame from Ambient.update (time-driven, no Phaser timers). */
  update(dt: number) {
    if (!this.dock || !hasSprite('culture:van:SE')) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = 20_000 + rand() * 25_000;
    if (this.active < MAX_VANS) this.drive();
  }

  get count() {
    return this.active;
  }

  /** One round trip: highway end → the lane beside the dock (unload) → highway end. */
  drive() {
    const g = this.traffic.graph;
    const at = this.dock && g.nearest(this.dock, (l) => !l.highway);
    if (!at) return false;
    const there = g.route(g.highwayEnd, at.lane.from);
    const back = g.route(at.lane.to, g.highwayEnd);
    if (!there.length || !back.length) return false;
    const ok = this.traffic.spawnRoute('van', 'culture:van', [...there, ...back], [{ lane: at.lane.id, s: at.s, ms: UNLOAD_MS }], () => this.active--);
    if (ok) this.active++;
    return ok;
  }
}
