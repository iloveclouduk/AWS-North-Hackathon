// The city's ambient life in one place (plan B3): road traffic and delivery vans, boats, the sky, and the dim baseline
// packets between landmarks. One update(dt) from CityScene drives it all, with pooled Images and no tweens. It pauses
// while the page is hidden, parks or stills everything under reduced motion (and follows that setting as it changes),
// rebuilds on a Region change, keeps to the per-surface budget (plan B6) and is torn down with the scene.
//
// None of it stands for AWS activity: agents' work animations do that (CLAUDE.md "Agent animation = real AWS activity"),
// and so do the data carriers dispatchData sends (real DataLinks and agent calls: src/world/carriers.ts).
// The baseline packets are dim, small and trail-less, and stop while a task of the player's runs.
import Phaser from 'phaser';
import { isDiscovered, useCity } from '@/state/store';
import { FLOWS } from '@/world/culture';
import { landmarkLayout, type Tile } from '@/world/layout';
import { availability } from '@/world/regions';
import { districtById, serviceById } from '@/world/taxonomy';
import { RIVER, type Terrain } from '@/world/terrain';
import { bus } from '@/state/bus';
import { carrierSkin, DATA_CAP, type Cargo, type CarrierKind } from '@/world/carriers';
import { CITIZEN_CAP, surfaceFor, trafficLevel, VEHICLE_CAP, type Surface } from '@/world/traffic';
import { addSprite, hasSprite, isPlaced } from './assets';
import { Boats, BOAT_CAP } from './Boats';
import { CITY_ISO, entityDepth, toScreen } from './iso';
import { reducedMotion } from './motion';
import { Vans } from './Ops';
import { FlowTrickle, PACKET_CAP, type Packets } from './Packets';
import { isZebra, RoadGraph, type Pt } from './RoadGraph';
import { rand } from './rng';
import { CLOUD_CAP, Sky } from './Sky';
import { Traffic, type Stop } from './Traffic';

/** How far past the view edge things are still drawn, world px (so nothing pops in at the border). */
const VIEW_PAD = 48;
const LEVEL_EVERY_MS = 2000;
const MOTION_EVERY_MS = 1000;
const BUS_STOP_MS = 2000;

export interface AmbientContext {
  packets: Packets;
  /** The landscape the city stands in (Landscape.terrain), once built. */
  terrain: () => Terrain | undefined;
  /** Where people are on foot (grid), so cars stop at the zebra crossings for them. */
  pedestrians: () => Pt[];
  /** A task of the player's is running: the baseline packets wait. */
  busy: () => boolean;
  /** How many citizens stroll the city now (for stats; CityScene keeps them to CITIZEN_CAP). */
  citizens?: () => number;
  /** The surface changed (the window crossed the panel width): CityScene keeps its citizens to the new cap. */
  onSurface?: (s: Surface) => void;
}

export interface AmbientStats {
  surface: Surface;
  citizens: number;
  vehicles: number;
  /** Data carriers among the vehicles (real DataLinks and agent calls). */
  data: number;
  boats: number;
  packets: number;
  ambientPackets: number;
  clouds: number;
  planes: number;
  flocks: number;
  headlights: number;
  tweens: number;
  children: number;
  caps: { citizens: number; vehicles: number; data: number; boats: number; packets: number; clouds: number };
  /** The game loop's measured frame rate (Phaser's actualFps), for the smoke's FPS line. */
  fps: number;
  reducedMotion: boolean;
}

/** The live scene's Ambient, for window.awsCity.ambient.stats() (dev builds only, src/app/mount.tsx). */
let current: Ambient | undefined;
export const ambientStats = (): AmbientStats | undefined => current?.stats();
/** Live tweens by what they animate (`Text`, `Image:city:lm:s3:2`…): the smoke prints it when the tween budget breaks. */
export const tweenCensus = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of current?.sceneTweens() ?? []) {
    const tg = t.targets?.[0] as { constructor?: { name?: string }; texture?: { key: string }; frame?: { name: string } } | undefined;
    const k = `${tg?.constructor?.name ?? typeof tg}${tg?.texture ? `:${tg.texture.key}:${tg.frame?.name ?? ''}` : ''}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

export class Ambient {
  private traffic?: Traffic;
  private vans?: Vans;
  private boats: Boats;
  private sky: Sky;
  private trickle: FlowTrickle;
  private stops: Phaser.GameObjects.Image[] = [];
  private busStops: Stop[] = [];
  private busRoute: number[] = [];
  private busWait = 15_000;
  private terrain?: Terrain;
  private surface: Surface;
  private still = reducedMotion();
  private night = 0;
  private levelAt = -Infinity;
  private motionAt = 0;
  private view = new Phaser.Geom.Rectangle();

  constructor(
    private scene: Phaser.Scene,
    private ctx: AmbientContext,
  ) {
    this.surface = surfaceFor(scene.scale.width);
    this.boats = new Boats(scene);
    this.sky = new Sky(scene);
    this.trickle = new FlowTrickle(ctx.packets, {
      flows: () => FLOWS,
      spot: (id) => this.spot(id),
      busy: () => ctx.busy(),
      color: (id) => {
        const s = serviceById(id);
        return s ? districtById(s.districtId)!.color : 0xff9900;
      },
    });
    ctx.packets.setCap(PACKET_CAP[this.surface]);
    // The live city's ambience, for awsCity.ambient.stats() (smoke tests): one at a time.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    current = this;
  }

  /** (Re)build for the landscape the scene has now: a new Region, or new AZs. Same landscape: nothing to do. */
  build() {
    const t = this.ctx.terrain();
    if (!t || t === this.terrain) return;
    this.clearWorld();
    this.terrain = t;
    const graph = new RoadGraph(t);
    this.traffic = new Traffic(this.scene, graph, {
      pedestrians: this.ctx.pedestrians,
      isBridge: (x, y) => t.kind(x, y) === 'bridge',
      isZebra,
    });
    this.traffic.dataCap = DATA_CAP[this.surface];
    this.traffic.onTap = (cargo) => bus.emit('carrierTap', { cargo });
    const dock = landmarkLayout('fulfilment');
    this.vans = new Vans(this.traffic, dock && isPlaced(dock) ? dock.workSpot : undefined);
    this.placeBusStops(t, graph);
    this.levelAt = -Infinity;
    this.syncLevel();
    this.traffic.setParked(this.still);
    if (!this.still) this.traffic.populate();
    this.boats.build(t, BOAT_CAP[this.surface], this.still);
    this.sky.build(t.gate, CLOUD_CAP[this.surface], this.still);
    this.trickle.reset();
    this.ctx.packets.clear();
  }

  setNight(n: number) {
    this.night = n;
  }

  /** Per frame from CityScene.update. */
  update(time: number, dt: number) {
    if (typeof document !== 'undefined' && document.hidden) return;
    const step = Math.min(dt, 100);
    if (time - this.motionAt > MOTION_EVERY_MS) {
      this.motionAt = time;
      this.syncMotion();
      const surface = surfaceFor(this.scene.scale.width);
      if (surface !== this.surface) this.setSurface(surface);
    }
    if (time - this.levelAt > LEVEL_EVERY_MS) {
      this.levelAt = time;
      this.syncLevel();
    }
    const cam = this.scene.cameras.main;
    const wv = cam.worldView;
    this.view.setTo(wv.x - VIEW_PAD, wv.y - VIEW_PAD, wv.width + 2 * VIEW_PAD, wv.height + 2 * VIEW_PAD);
    this.traffic?.update(step, this.view, this.night);
    if (!this.still) {
      this.vans?.update(step);
      this.updateBus(step);
      this.trickle.update(step);
    }
    this.boats.update(step, time, this.view);
    this.sky.update(step, this.view, cam.zoom);
    this.ctx.packets.update(step);
  }

  /**
   * A data carrier from one grid point to another (`'highway'`: the far end of the highway, out of the Region) along
   * the roads. False when it can't drive now (reduced motion, DATA_CAP, no room): the caller shows the data as packets.
   */
  dispatchData(kind: CarrierKind, from: Tile | 'highway', to: Tile | 'highway', cargo: Cargo): boolean {
    const t = this.traffic;
    if (!t || this.still) return false;
    const g = t.graph;
    const node = (p: Tile | 'highway') => (p === 'highway' ? g.highwayEnd : (g.node(p.x, p.y) ?? g.nearestNode(p)));
    const nodes = g.route(node(from), node(to));
    return t.spawnData(kind === 'tanker' ? 'truck' : 'car', carrierSkin(kind), nodes, cargo);
  }

  /** Per-surface caps (plan B6): the side panel carries less. */
  setSurface(s: Surface) {
    this.surface = s;
    if (this.traffic) this.traffic.dataCap = DATA_CAP[s];
    this.ctx.packets.setCap(PACKET_CAP[s]);
    this.ctx.onSurface?.(s);
    this.levelAt = -Infinity;
    if (this.terrain) {
      this.boats.build(this.terrain, BOAT_CAP[s], this.still);
      this.sky.build(this.terrain.gate, CLOUD_CAP[s], this.still);
    }
  }

  sceneTweens() {
    return this.scene.tweens.getTweens();
  }

  stats(): AmbientStats {
    const sky = this.sky.counts;
    return {
      surface: this.surface,
      citizens: this.ctx.citizens?.() ?? 0,
      vehicles: this.traffic?.count ?? 0,
      data: this.traffic?.dataCount ?? 0,
      boats: this.boats.count,
      packets: this.ctx.packets.count,
      ambientPackets: this.ctx.packets.ambientCount,
      ...sky,
      headlights: this.traffic?.stats().lit ?? 0,
      tweens: this.scene.tweens.getTweens().length,
      children: this.scene.children.length,
      caps: { citizens: CITIZEN_CAP[this.surface], vehicles: VEHICLE_CAP[this.surface], data: DATA_CAP[this.surface], boats: BOAT_CAP[this.surface], packets: PACKET_CAP[this.surface], clouds: CLOUD_CAP[this.surface] },
      reducedMotion: this.still,
      fps: Math.round(this.scene.game.loop.actualFps),
    };
  }

  destroy() {
    this.clearWorld();
    this.boats.destroy();
    this.sky.destroy();
    this.trickle.reset();
    if (current === this) current = undefined;
  }

  // ── inside ────────────────────────────────────────────────────────────────

  private clearWorld() {
    this.traffic?.destroy();
    this.traffic = undefined;
    this.vans = undefined;
    for (const s of this.stops) s.destroy();
    this.stops = [];
    this.busStops = [];
    this.busRoute = [];
    this.boats.clear();
    this.sky.clear();
    this.terrain = undefined;
  }

  /** The OS setting changed: park or release the cars, still or launch the boats and the sky. */
  private syncMotion() {
    const still = reducedMotion();
    if (still === this.still) return;
    this.still = still;
    this.traffic?.setParked(still);
    this.boats.setStill(still);
    this.sky.setStill(still);
    this.trickle.reset();
  }

  /** Traffic from the account: resources in this Region, plus its bill when the player turned the bill on. */
  private syncLevel() {
    if (!this.traffic) return;
    const s = useCity.getState();
    const region = s.cityRegion;
    this.traffic.setTarget(trafficLevel(s.inventory, s.billOn ? s.bill : undefined, region, this.surface), VEHICLE_CAP[this.surface]);
    // Data moving between Regions: planes overhead more often (the data itself drives out as tankers, RegionOverlay).
    const crossRegion = (s.inventory?.links ?? []).some((l) => l.from.region !== l.to.region && (l.from.region === region || l.to.region === region));
    this.sky.busyAir = crossRegion;
  }

  /** A landmark's work spot when its service is discovered and offered in this Region (the trickle's ends). */
  private spot(id: string): Tile | undefined {
    const s = useCity.getState();
    if (!isDiscovered(s.progress, id, s.cityRegion) || availability(id, s.cityRegion).status !== 'available') return undefined;
    return landmarkLayout(id)?.workSpot;
  }

  /** Up to two bus stops on the promenade, beside the roads out to the bridges; the bus calls at both. */
  private placeBusStops(t: Terrain, graph: RoadGraph) {
    if (!hasSprite('busStop') || !hasSprite('veh:bus:SE')) return;
    const picks = t.bridges.filter((b) => !b.highway && b.tiles.length);
    const chosen: typeof picks = [];
    while (picks.length && chosen.length < 2) chosen.push(picks.splice(Math.floor(rand() * picks.length), 1)[0]);
    for (const b of chosen) {
      // The promenade road tile on the core side of the bridge, and a paver beside it for the shelter.
      const first = b.tiles[0];
      const inward = b.side === 'N' ? [0, 1] : b.side === 'S' ? [0, -1] : b.side === 'W' ? [1, 0] : [-1, 0];
      const road = { x: first.x + inward[0] * (RIVER.from - 1), y: first.y + inward[1] * (RIVER.from - 1) };
      const sideways = inward[0] ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      const pad = sideways.map(([dx, dy]) => ({ x: road.x + dx, y: road.y + dy })).find((p) => t.kind(p.x, p.y) === 'promenade' && !graph.isRoad(p.x, p.y));
      if (!pad) continue;
      const at = graph.nearest(pad, (l) => graph.edges[l.edge].tiles.some((tt) => tt.x === road.x && tt.y === road.y) && graph.nodes[l.from].kind !== 'deadEnd');
      if (!at) continue;
      const n = toScreen(CITY_ISO, pad.x - 0.5, pad.y - 0.5);
      this.stops.push(addSprite(this.scene, 'busStop', n.x, n.y).setDepth(entityDepth(toScreen(CITY_ISO, pad.x, pad.y).y)));
      this.busStops.push({ lane: at.lane.id, s: at.s, ms: BUS_STOP_MS });
    }
    // The bus's round: in from the highway, out to each stop's dead end and back, then away.
    let nodes = [graph.highwayEnd];
    for (const st of this.busStops) {
      const lane = graph.lanes[st.lane];
      const r = [...graph.route(nodes[nodes.length - 1], lane.from), lane.to];
      nodes = [...nodes, ...r.slice(1)];
    }
    nodes = [...nodes, ...graph.route(nodes[nodes.length - 1], graph.highwayEnd).slice(1)];
    this.busRoute = this.busStops.length ? nodes : [];
  }

  /** A bus on its round every 40–70 s, one at a time. */
  private updateBus(dt: number) {
    if (!this.traffic || !this.busRoute.length) return;
    this.busWait -= dt;
    if (this.busWait > 0) return;
    this.busWait = 40_000 + rand() * 30_000;
    if (this.traffic.countOf('bus') > 0) return;
    this.traffic.spawnRoute('bus', 'veh:bus', this.busRoute, this.busStops.map((s) => ({ ...s })));
  }
}
