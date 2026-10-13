// Ambient road traffic (plan B3): pooled vehicle Images that follow the lanes of the RoadGraph in the scene's update,
// with no tweens. A vehicle keeps a gap to the one ahead, enters a junction only when its box is free and the lane it
// leaves by has room, gives way at a zebra crossing a pedestrian is on, turns at random (no U-turns except at dead
// ends), and comes and goes at the far end of the highway. Off-screen vehicles keep driving but aren't redrawn.
// Under reduced motion the cars are parked at the curb instead. Vehicles are ambience, with one exception: data
// carriers (spawnData, driven by src/game/RegionOverlay.ts via Ambient.dispatchData) stand for real data, wear the data
// sprites with a roof beacon and can be tapped. Ambient cars only look like data on the move (server, packet, fibre and
// cloud vans, art/tiles/vehicles_art.py): no beacon, no meaning.
import Phaser from 'phaser';
import { addSprite, hasSprite, spriteAnchor } from './assets';
import { CITY_ISO, dirFor, entityDepth, toScreen } from './iso';
import type { Cargo } from '@/world/carriers';
import { pointAt, type Lane, type Pt, type RoadGraph } from './RoadGraph';
import { rand } from './rng';

/** Centre-to-centre gap kept to the vehicle ahead, tiles. */
export const GAP = 1.05;
/** Headlights lit at once at night, at most. */
export const MAX_HEADLIGHTS = 8;
const BRIDGE_DECK_PX = 3;
const HEADLIGHT_DEPTH = 70_001;
/** A vehicle stuck at a junction this long picks another way; this long again and it leaves. */
const REROUTE_MS = 5000;
const GIVE_UP_MS = 15_000;
/** Longest a vehicle waits at one zebra crossing. */
const YIELD_MAX_MS = 4000;
/** How far a pointer may move between down and up and still count as a tap on a carrier (not a camera drag), px. */
const TAP_SLOP = 8;

export type VehicleKind = 'car' | 'bus' | 'truck' | 'van';
const SPEED: Record<VehicleKind, number> = { car: 2.2, bus: 1.5, truck: 1.7, van: 1.9 };
const CAR_SKINS = ['veh:car:server', 'veh:car:packet', 'veh:car:fibre', 'veh:car:cloud'];

export interface Stop {
  lane: number;
  s: number;
  ms: number;
}

interface Vehicle {
  img: Phaser.GameObjects.Image;
  kind: VehicleKind;
  /** Frame prefix: `${skin}:${dir}`. */
  skin: string;
  lane: Lane;
  s: number;
  /** Inside a junction box: the connector and how far along it. */
  box?: { pts: Pt[]; cum: number[]; len: number; s: number; node: number; next: Lane };
  /** The lane it leaves the next junction by (chosen on entering a lane, so the room check knows it). */
  next?: Lane;
  /** A node path to follow (vans, buses, anything leaving); index of the node it's heading for. */
  route?: number[];
  ri: number;
  /** Junctions to pass before heading home to the highway. */
  trips: number;
  stops: Stop[];
  dwell: number;
  waited: number;
  yielded: number;
  x: number;
  y: number;
  dir: string;
  parked: boolean;
  /** Called once when it leaves the map. */
  done?: () => void;
  /** A data carrier: what it carries. It drives its route and is gone at the end of it (never wanders home). */
  cargo?: Cargo;
}

export interface TrafficOpts {
  /** Where pedestrians stand (grid), for the zebra crossings. */
  pedestrians: () => Pt[];
  /** A tile the decks of a bridge cover (vehicles ride on top, a few px up). */
  isBridge: (x: number, y: number) => boolean;
  /** A zebra crossing tile. */
  isZebra: (x: number, y: number) => boolean;
}

export class Traffic {
  private vehicles: Vehicle[] = [];
  private spare: Phaser.GameObjects.Image[] = [];
  private lights: Phaser.GameObjects.Image[] = [];
  /** Which vehicle holds each junction box. */
  private boxes = new Map<number, Vehicle>();
  private target = 0;
  private cap = 14;
  private spawnWait = 0;
  private parked = false;
  /** Share of trucks among the ambient traffic. */
  truckShare = 0.12;
  /** Data carriers at once, at most (DATA_CAP for the surface). */
  dataCap = 6;
  /** A data carrier was tapped. */
  onTap?: (cargo: Cargo) => void;

  constructor(
    private scene: Phaser.Scene,
    readonly graph: RoadGraph,
    private opts: TrafficOpts,
  ) {}

  get count() {
    return this.vehicles.length;
  }

  countOf(kind: VehicleKind) {
    return this.vehicles.filter((v) => v.kind === kind).length;
  }

  get dataCount() {
    return this.vehicles.filter((v) => v.cargo).length;
  }

  /** How many vehicles to keep on the roads (trafficLevel), and the surface's hard cap. */
  setTarget(n: number, cap: number) {
    if (cap === this.cap && Math.min(n, cap) === this.target) return;
    this.cap = cap;
    this.target = Math.min(n, cap);
    // Over the cap (the panel narrowed): the extras leave now.
    for (const v of this.vehicles.slice(cap)) this.remove(v);
    if (this.parked) this.park();
    // Over the target: the newest wanderers head home.
    let extra = this.vehicles.length - this.target;
    for (const v of [...this.vehicles].reverse()) {
      if (extra <= 0) break;
      if (v.route || v.kind === 'van') continue;
      v.trips = 0;
      extra--;
    }
  }

  /** Fill the roads at once (a new city shouldn't start empty), spread over the core's lanes. */
  populate() {
    if (this.parked) return this.park();
    const lanes = this.graph.lanes.filter((l) => !l.highway && l.len >= 2);
    let tries = 0;
    while (this.vehicles.length < this.target && tries++ < 200 && lanes.length) {
      const lane = lanes[Math.floor(rand() * lanes.length)];
      const s = 0.5 + rand() * (lane.len - 1);
      if (this.vehicles.some((v) => v.lane === lane && Math.abs(v.s - s) < GAP * 1.5)) continue;
      this.add(this.pickKind(), lane, s);
    }
  }

  /**
   * A vehicle with a job: from the highway end along `nodes`, stopping at `stops`, then away (vans, buses). Returns
   * false when the roads are full or the highway entry has no room.
   */
  spawnRoute(kind: VehicleKind, skin: string, nodes: number[], stops: Stop[], done?: () => void) {
    if (this.parked || this.vehicles.length >= this.cap || nodes.length < 2) return false;
    const lane = this.graph.laneBetween(nodes[0], nodes[1]);
    if (!lane || !this.roomAt(lane, 0)) return false;
    const v = this.add(kind, lane, 0, skin);
    v.route = nodes;
    v.ri = 1;
    v.stops = stops;
    v.done = done;
    this.chooseNext(v);
    return true;
  }

  /**
   * A data carrier along `nodes` (a road route), gone when it reaches the last node. When the roads are full an
   * ambient vehicle gives way (one off-screen if there is one), never another carrier. Returns false when it can't
   * go now (parked, DATA_CAP reached, or no room to enter): the caller shows the data another way.
   */
  spawnData(kind: VehicleKind, skin: string, nodes: number[], cargo: Cargo) {
    if (this.parked || nodes.length < 2 || this.dataCount >= this.dataCap || !hasSprite(`${skin}:SE`)) return false;
    const lane = this.graph.laneBetween(nodes[0], nodes[1]);
    if (!lane || !this.roomAt(lane, 0)) return false;
    if (this.vehicles.length >= this.cap) {
      const ambient = this.vehicles.filter((v) => !v.cargo && !v.box && v.kind !== 'van' && v.kind !== 'bus');
      const victim = ambient.find((v) => !v.img.visible) ?? ambient[0];
      if (!victim) return false;
      this.remove(victim);
    }
    const v = this.add(kind, lane, 0, skin);
    v.route = nodes;
    v.ri = 1;
    v.cargo = cargo;
    v.img.setInteractive({ useHandCursor: true });
    v.img.on('pointerup', (p: Phaser.Input.Pointer) => p.getDistance() < TAP_SLOP && this.onTap?.(cargo));
    this.chooseNext(v);
    return true;
  }

  /** Reduced motion: every car parked at a seeded spot by the curb, nothing moving. */
  setParked(on: boolean) {
    if (on === this.parked) return;
    this.parked = on;
    this.clear();
    if (on) this.park();
    else this.populate();
  }

  update(dt: number, view: Phaser.Geom.Rectangle, night: number) {
    if (!this.parked) {
      const s = dt / 1000;
      const peds = this.opts.pedestrians();
      const occupied = new Set(peds.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
      for (const v of [...this.vehicles]) this.step(v, s, dt, occupied);
      this.spawn(dt);
    }
    this.draw(view, night);
  }

  stats() {
    return { vehicles: this.vehicles.length, data: this.dataCount, target: this.target, cap: this.cap, lit: this.lights.filter((l) => l.visible).length };
  }

  clear() {
    for (const v of [...this.vehicles]) this.remove(v);
    this.boxes.clear();
  }

  destroy() {
    this.clear();
    for (const i of this.spare) i.destroy();
    for (const l of this.lights) l.destroy();
    this.spare = [];
    this.lights = [];
  }

  // ── moving ────────────────────────────────────────────────────────────────

  private step(v: Vehicle, s: number, dt: number, occupied: Set<string>) {
    if (v.dwell > 0) {
      v.dwell -= dt;
      return;
    }
    const speed = SPEED[v.kind] * (v.lane.highway && !v.box ? 1.5 : 1);
    if (v.box) {
      v.box.s += speed * s;
      if (v.box.s < v.box.len) return;
      const over = v.box.s - v.box.len;
      this.boxes.delete(v.box.node);
      v.lane = v.box.next;
      v.s = Math.min(over, 0.2);
      v.box = undefined;
      this.chooseNext(v);
      return;
    }
    let want = v.s + speed * s;
    // The vehicle ahead on this lane.
    for (const o of this.vehicles) if (o !== v && !o.box && o.lane === v.lane && o.s > v.s) want = Math.min(want, o.s - GAP);
    // A stop on this lane (a van unloading, a bus at its stop).
    const stop = v.stops.find((st) => st.lane === v.lane.id && st.s >= v.s - 0.01);
    if (stop && want >= stop.s) {
      v.s = stop.s;
      v.dwell = stop.ms;
      v.stops = v.stops.filter((st) => st !== stop);
      return;
    }
    // Give way at a zebra crossing someone is on (for a while: someone chatting on the crossing gets edged past).
    const blocked = [0.35, 0.75].some((ahead) => {
      const p = pointAt(v.lane.pts, v.lane.cum, v.s + ahead);
      const tx = Math.round(p.x);
      const ty = Math.round(p.y);
      return this.opts.isZebra(tx, ty) && occupied.has(`${tx},${ty}`);
    });
    if (!blocked) v.yielded = 0;
    else if (v.yielded < YIELD_MAX_MS) (v.yielded += dt), (want = Math.min(want, v.s));
    if (want < v.lane.len) {
      v.s = Math.max(v.s, want);
      return;
    }
    // At the end of the lane: leave the map, or cross the junction when it's clear.
    const node = v.lane.to;
    if (node === this.graph.highwayEnd && (v.route || v.trips <= 0)) return this.remove(v);
    // A carrier has delivered: it's gone where its data went (an island's road end, the highway).
    if (v.cargo && v.route && node === v.route[v.route.length - 1]) return this.remove(v);
    v.s = v.lane.len;
    if (!v.next) this.chooseNext(v);
    const next = v.next;
    if (!next) return this.remove(v);
    const holder = this.boxes.get(node);
    if ((holder && holder !== v) || !this.roomAt(next, GAP)) {
      v.waited += dt;
      if (v.waited > GIVE_UP_MS) return this.remove(v);
      if (v.waited > REROUTE_MS && !v.route) this.chooseNext(v, next);
      return;
    }
    v.waited = 0;
    const pts = this.graph.connector(v.lane, next);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    v.box = { pts, cum, len: cum[cum.length - 1], s: 0, node, next };
    this.boxes.set(node, v);
    if (!v.route) v.trips--;
  }

  /** Nobody within `gap` of the start of a lane (and nobody in a box about to pour into it). */
  private roomAt(lane: Lane, gap: number) {
    return !this.vehicles.some((o) => (!o.box && o.lane === lane && o.s < gap + 0.2) || o.box?.next === lane);
  }

  /** The lane to leave the coming junction by: the route's, or a random one (not back the way it came, not onto the highway unless leaving). */
  private chooseNext(v: Vehicle, avoid?: Lane) {
    const node = v.lane.to;
    if (v.route) {
      while (v.ri < v.route.length && v.route[v.ri] !== node) v.ri++;
      const to = v.route[v.ri + 1];
      v.next = to === undefined ? undefined : this.graph.laneBetween(node, to);
      if (!v.next && node !== this.graph.highwayEnd && !v.cargo) this.headHome(v);
      return;
    }
    if (v.trips <= 0) return this.headHome(v);
    const out = this.graph.lanesFrom(node).filter((l) => l.edge !== v.lane.edge && l.to !== this.graph.highwayEnd && l !== avoid);
    // Dead ends are fine to visit (a U-turn there), just less often.
    const pick = out.filter((l) => this.graph.nodes[l.to].kind !== 'deadEnd' || rand() < 0.35);
    const from = pick.length ? pick : out;
    v.next = from.length ? from[Math.floor(rand() * from.length)] : this.graph.lane(v.lane.edge, node);
  }

  /** Route to the highway end and away. */
  private headHome(v: Vehicle) {
    const node = v.lane.to;
    const r = this.graph.route(node, this.graph.highwayEnd);
    v.route = [v.lane.from, ...r];
    v.ri = 1;
    const to = r[1];
    v.next = to === undefined ? undefined : this.graph.laneBetween(node, to);
  }

  private spawn(dt: number) {
    this.spawnWait -= dt;
    if (this.spawnWait > 0 || this.vehicles.length >= this.target) return;
    this.spawnWait = 1500 + rand() * 2500;
    const out = this.graph.lanesFrom(this.graph.highwayEnd)[0];
    if (!out || !this.roomAt(out, GAP * 1.5)) return;
    this.add(this.pickKind(), out, 0);
  }

  private pickKind(): VehicleKind {
    const r = rand();
    const buses = this.countOf('bus');
    if (r < 0.1 && buses < (this.cap > 8 ? 2 : 1) && hasSprite('veh:bus:SE')) return 'bus';
    if (r < 0.1 + this.truckShare && hasSprite('veh:truck:SE')) return 'truck';
    return 'car';
  }

  private add(kind: VehicleKind, lane: Lane, s: number, skin?: string): Vehicle {
    const sk = skin ?? (kind === 'car' ? CAR_SKINS[Math.floor(rand() * CAR_SKINS.length)] : `veh:${kind}`);
    const frame = `${sk}:SE`;
    const reused = this.spare.pop();
    const a = spriteAnchor(frame);
    // Kinds differ in canvas size, so a reused Image takes the new frame's anchor too.
    const img = reused ? reused.setFrame(frame).setVisible(true).setOrigin(a ? a.ax / a.w : 0.5, a ? a.ay / a.h : 0.5) : addSprite(this.scene, frame, 0, 0);
    const v: Vehicle = { img, kind, skin: sk, lane, s, ri: 0, trips: 6 + Math.floor(rand() * 14), stops: [], dwell: 0, waited: 0, yielded: 0, x: 0, y: 0, dir: 'SE', parked: false };
    this.vehicles.push(v);
    if (!skin && kind !== 'van') this.chooseNext(v);
    return v;
  }

  private remove(v: Vehicle) {
    const i = this.vehicles.indexOf(v);
    if (i < 0) return;
    this.vehicles.splice(i, 1);
    if (v.box) this.boxes.delete(v.box.node);
    // Images are pooled: a carrier's tap target must not follow its Image into an ambient car.
    if (v.cargo) v.img.disableInteractive().removeAllListeners('pointerup');
    v.img.setVisible(false);
    this.spare.push(v.img);
    v.done?.();
  }

  /** Parked at seeded curbs: a little further out than the lane, on the core's quieter roads. */
  private park() {
    this.clear();
    const lanes = this.graph.lanes.filter((l) => !l.highway && l.len >= 3);
    let tries = 0;
    while (this.vehicles.length < this.target && tries++ < 200 && lanes.length) {
      const lane = lanes[Math.floor(rand() * lanes.length)];
      const s = 1 + Math.floor(rand() * (lane.len - 2));
      if (this.vehicles.some((v) => v.lane === lane && Math.abs(v.s - s) < 1.2)) continue;
      const kind: VehicleKind = rand() < 0.15 && hasSprite('veh:truck:SE') ? 'truck' : 'car';
      const v = this.add(kind, lane, s);
      v.parked = true;
    }
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  private draw(view: Phaser.Geom.Rectangle, night: number) {
    let lit = 0;
    const wantLights = night > 0.35 && !this.parked;
    for (const v of this.vehicles) {
      const p = v.box ? pointAt(v.box.pts, v.box.cum, v.box.s) : pointAt(v.lane.pts, v.lane.cum, v.s);
      let { x, y } = p;
      if (v.parked) {
        // Pulled in to the curb (further right of the lane).
        const d = Math.hypot(p.dx, p.dy) || 1;
        x += (-p.dy / d) * 0.14;
        y += (p.dx / d) * 0.14;
      }
      v.x = x;
      v.y = y;
      const c = toScreen(CITY_ISO, x, y);
      const on = view.contains(c.x, c.y);
      v.img.setVisible(on);
      if (!on) continue;
      if (Math.abs(p.dx) + Math.abs(p.dy) > 1e-6) v.dir = dirFor(p.dx, p.dy);
      const frame = `${v.skin}:${v.dir}`;
      if (v.img.frame.name !== frame) v.img.setFrame(frame);
      const tx = Math.round(x);
      const ty = Math.round(y);
      const deck = this.opts.isBridge(tx, ty);
      // The sprite's footprint is 1×1 centred on the point: its N corner half a tile up each axis.
      const n = toScreen(CITY_ISO, x - 0.5, y - 0.5);
      v.img.setPosition(Math.round(n.x), Math.round(n.y) - (deck ? BRIDGE_DECK_PX : 0));
      let depth = entityDepth(c.y) + 0.5;
      if (deck) depth = Math.max(depth, entityDepth(toScreen(CITY_ISO, tx, ty).y) + 1);
      v.img.setDepth(depth);
      if (wantLights && lit < MAX_HEADLIGHTS && hasSprite('headlight')) {
        const d = Math.hypot(p.dx, p.dy) || 1;
        const h = toScreen(CITY_ISO, x + (p.dx / d) * 0.55, y + (p.dy / d) * 0.55);
        const light = this.lights[lit] ?? this.lights[this.lights.push(addSprite(this.scene, 'headlight', 0, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(HEADLIGHT_DEPTH)) - 1];
        light.setPosition(Math.round(h.x), Math.round(h.y) - 3 - (deck ? BRIDGE_DECK_PX : 0)).setAlpha(Math.min(1, night) * 0.85).setVisible(true);
        lit++;
      }
    }
    for (let i = lit; i < this.lights.length; i++) this.lights[i].setVisible(false);
  }
}
