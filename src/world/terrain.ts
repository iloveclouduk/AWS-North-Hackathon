// The landscape round the city (pure, no Phaser): a non-walkable ring EXT tiles wide round the 40×40 core. A river
// rings downtown, and each of the Region's real Availability Zones is an island across it with a bridge to a core road
// (plan B4: data halls, a substation, a cooling tower, a fence and the AZ's sign), a highway leaves through the
// Region gate to the horizon, and the coast and biome come from the world map sampled round the Region's real
// latitude and longitude. Deterministic per Region: the same code always builds the same landscape.
//
// The world map is Natural Earth 1:110m on 3.75° cells, so the coast is an impression of where the sea is, not a
// survey: small islands (Singapore, Bahrain) and narrow straits can come out wrong. The river is always there.
import { CITY_ISO, cornerScreen } from '@/game/iso';
import { mulberry32 } from '@/game/rng';
import { WORLD_MAP } from './culture';
import { azSlotsFor, GATE, GRID, ISLAND_ROAD, RIVER, slotRect, type Rect, type Tile } from './layout';
import { PARK_H, PARK_W } from './park';
import { neighbours, regionInfo, signatureFor, signatureSprite, type Zone } from './regions';

/** How far the landscape reaches beyond the core, in tiles. */
export const EXT = 18;
export const RING_MIN = -EXT;
export const RING_MAX = GRID - 1 + EXT;
/** Width of the whole map (core + ring), tiles. */
export const RING_SIZE = GRID + 2 * EXT;
/** The river runs RIVER.from..RIVER.to tiles out from the core (inclusive), all the way round. */
export { GATE, RIVER };
/** The core road lines (x or y): where they meet the river there's a bridge. */
export const ROAD_LINES = [0, 13, 26, 39] as const;

export type TerrainKind = 'core' | 'river' | 'promenade' | 'beach' | 'land' | 'field' | 'forest' | 'sea' | 'highway' | 'bridge' | 'island';
export type Biome = 'temperate' | 'boreal' | 'arid' | 'tropical';
export type Side = 'N' | 'E' | 'S' | 'W';

export interface TerrainProp {
  sprite: string;
  /** Footprint (the sprite's N corner sits on the N corner of tile x, y). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** What it is, for the scene: turbines spin, the lighthouse glows, signs get a label. */
  role?: 'turbine' | 'lighthouse' | 'sign' | 'gate' | 'bridge' | 'island' | 'home' | 'signature';
  /** For a sign: the Region it points at. */
  to?: string;
  /** For the Region's signature: its name in plain words (shown on hover or close up). */
  label?: string;
}

export interface Bridge {
  side: Side;
  /** The core road line it carries (x for N/S, y for E/W), or the highway row. */
  line: number;
  axis: 'x' | 'y';
  tiles: Tile[];
  highway?: boolean;
}

/** A fence panel baked into the ground (x, y may be half tiles: the fence runs along the island's edge). */
export interface Fence {
  sprite: 'fenceX' | 'fenceY';
  x: number;
  y: number;
}

/** An Availability Zone's island: a concrete pad across the river, its bridge and its road (layout.azsFor places it). */
export interface Island {
  slot: string;
  side: 'N' | 'W';
  rect: Rect;
  /** The island's own road, from the bridge inwards (its last tile is the dead end traffic turns at). */
  road: Tile[];
  fences: Fence[];
}

export interface Destination {
  code: string;
  city: string;
  km: number;
}

export interface Terrain {
  region: string;
  biome: Biome;
  /** What covers tile (x, y); outside the ring it's sea. */
  kind(x: number, y: number): TerrainKind;
  /** The ground sprite to bake for a ring tile, or undefined for water (the sea shows through) and the core. */
  ground(x: number, y: number): string | undefined;
  props: TerrainProp[];
  /** Road tiles outside the core (not the highway): through the promenade, over the bridges and a little beyond. */
  roads: (Tile & { axis: 'x' | 'y' })[];
  bridges: Bridge[];
  highway: Tile[];
  gate: Tile;
  destinations: Destination[];
  /** Tiles kept for the AZ islands, by slot name. */
  reserved: Record<string, Rect>;
  /** re:Play Park's site (src/world/park.ts lays out the rides), when the Region has open land for it. */
  park?: Rect;
  /** One island per AZ (in zonesFor order), across the river. */
  islands: Island[];
  /** The whole map in world pixels (camera bounds). */
  bounds: { x: number; y: number; w: number; h: number };
}

/**
 * Biomes the latitude rule gets wrong. Approximate, for the look of the countryside only: not a climate claim.
 * Rule: |lat| ≥ 55 boreal, |lat| < 24 tropical, else temperate.
 */
const BIOME_OVERRIDES: Record<string, Biome> = {
  'ca-west-1': 'boreal', // Calgary: the Rockies, long snowy winters
  'me-central-1': 'arid', // UAE
  'me-south-1': 'arid', // Bahrain
  'il-central-1': 'arid', // Tel Aviv: dry summers, desert to the south
  'mx-central-1': 'arid', // Querétaro: high semi-desert
  'ap-south-2': 'arid', // Hyderabad: semi-arid Deccan plateau
  'ap-east-2': 'tropical', // Taipei: subtropical, palms
};
/**
 * Where the 3.75° mask misplaces the coast badly enough to mislead (approximate, see the header): extra land (+) or
 * sea (−) bias for the whole ring.
 */
const COAST_OVERRIDES: Record<string, number> = {
  'ap-southeast-1': 0.15, // Singapore: the mask has no island at all; keep some shore round the city
  'me-south-1': 0.2, // Bahrain: same, a small island in the Gulf
};

export const biomeFor = (code: string): Biome => {
  if (BIOME_OVERRIDES[code]) return BIOME_OVERRIDES[code];
  const lat = Math.abs(regionInfo(code)?.lat ?? 40);
  return lat >= 55 ? 'boreal' : lat < 24 ? 'tropical' : 'temperate';
};

/** Tiles beyond the core's edge (Chebyshev), 0 inside it. */
export const outside = (x: number, y: number) => Math.max(0, -x, x - (GRID - 1), -y, y - (GRID - 1));
const inRing = (x: number, y: number) => x >= RING_MIN && y >= RING_MIN && x <= RING_MAX && y <= RING_MAX;

/** FNV-1a: a stable 32-bit hash of the Region code, the landscape's seed. */
export const hashCode = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

/** Smooth value noise in [0, 1] on a lattice `cell` tiles apart. */
function valueNoise(rng: () => number, cell: number) {
  const n = Math.ceil(RING_SIZE / cell) + 2;
  const lattice = Array.from({ length: n * n }, rng);
  const at = (i: number, j: number) => lattice[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = (x - RING_MIN) / cell;
    const fy = (y - RING_MIN) / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = smooth(fx - i);
    const v = smooth(fy - j);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
}

/** Land (1) or sea (0) at a latitude/longitude, bilinear between the world map's cell centres. */
export function landAt(lat: number, lon: number) {
  const m = WORLD_MAP;
  const cx = ((((lon - m.lonMin) % 360) + 360) % 360) / ((m.lonMax - m.lonMin) / m.cols) - 0.5;
  const cy = (m.latMax - lat) / ((m.latMax - m.latMin) / m.rows) - 0.5;
  const cell = (i: number, j: number) => (m.mask[Math.max(0, Math.min(m.rows - 1, j))]?.[((i % m.cols) + m.cols) % m.cols] === '#' ? 1 : 0);
  const i = Math.floor(cx);
  const j = Math.floor(cy);
  const u = cx - i;
  const v = cy - j;
  return (cell(i, j) * (1 - u) + cell(i + 1, j) * u) * (1 - v) + (cell(i, j + 1) * (1 - u) + cell(i + 1, j + 1) * u) * v;
}

const R = Math.PI / 180;
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const h = Math.sin(((b.lat - a.lat) * R) / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(((b.lon - a.lon) * R) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/** Highway row and its verge. */
const HIGHWAY_ROW = GATE.y;

const BIOME_TREES: Record<Biome, string[]> = {
  temperate: ['tree1', 'pine', 'tree0', 'bush'],
  boreal: ['pineSnow', 'pine', 'pineSnow'],
  arid: ['cactus', 'rock', 'bush'],
  tropical: ['palm', 'tree1', 'palm', 'bush'],
};
/** How much of the land is wooded, and farmed. */
const BIOME_COVER: Record<Biome, { forest: number; field: number }> = {
  temperate: { forest: 0.58, field: 0.6 },
  boreal: { forest: 0.5, field: 0.78 },
  arid: { forest: 0.74, field: 0.74 },
  tropical: { forest: 0.54, field: 0.66 },
};

/** Every prop the ring may hold (the scene's image budget). */
export const MAX_PROPS = 240;
/** Homes in the suburbs, at most. */
export const SUBURB_HOMES = 36;

/** The landscape for a Region. `zones` decides which island slots stay clear; `linked` adds signs for account links. */
export function terrainFor(region: string, zones: Zone[] = [], linked: string[] = []): Terrain {
  const rng = mulberry32(hashCode(region));
  const info = regionInfo(region);
  const lat = info?.lat ?? 40;
  const lon = info?.lon ?? 0;
  const biome = biomeFor(region);
  const coarse = valueNoise(rng, 9);
  const fine = valueNoise(rng, 4);
  const woods = valueNoise(rng, 7);
  const farms = valueNoise(rng, 8);
  const bias = COAST_OVERRIDES[region] ?? 0;

  const slots = azSlotsFor(zones.length || 3);
  const reserved: Record<string, Rect> = Object.fromEntries(slots.map((s) => [s, slotRect(s)]));
  const inReserve = (x: number, y: number) => Object.values(reserved).some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);

  const N = RING_SIZE;
  const idx = (x: number, y: number) => (y - RING_MIN) * N + (x - RING_MIN);
  const KINDS: TerrainKind[] = ['core', 'river', 'promenade', 'beach', 'land', 'field', 'forest', 'sea', 'highway', 'bridge', 'island'];
  const K = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<TerrainKind, number>;
  const grid = new Uint8Array(N * N);
  const set = (x: number, y: number, k: TerrainKind) => inRing(x, y) && (grid[idx(x, y)] = K[k]);
  const get = (x: number, y: number): TerrainKind => (inRing(x, y) ? KINDS[grid[idx(x, y)]] : 'sea');

  // 1. Land or sea, from the world map round the Region: each tile looks out in its own direction from the city,
  //    from ~0.6° at the river to ~4.5° at the edge of the map.
  const isLand = (x: number, y: number) => {
    const d = outside(x, y);
    const dx = x - (GRID - 1) / 2;
    const dy = y - (GRID - 1) / 2;
    const east = dx - dy; // screen right
    const north = -(dx + dy); // screen up
    const len = Math.hypot(east, north) || 1;
    const g = 0.6 + d * 0.22;
    const sample = landAt(lat + (north / len) * g, lon + ((east / len) * g) / Math.max(0.2, Math.cos(lat * R)));
    const nearCity = Math.max(0, 1 - (d - 5) / 7) * 0.32;
    // The map's own edge drops to the sea, so the land always ends in a coast, never a cut.
    const rim = Math.max(0, d - (EXT - 3)) * 0.3;
    return sample * 0.75 + nearCity - rim + (coarse(x, y) - 0.5) * 0.5 + (fine(x, y) - 0.5) * 0.18 + bias > 0.5;
  };
  for (let y = RING_MIN; y <= RING_MAX; y++)
    for (let x = RING_MIN; x <= RING_MAX; x++) {
      const d = outside(x, y);
      if (d === 0) set(x, y, 'core');
      else if (d === 1) set(x, y, 'promenade');
      else if (d >= RIVER.from && d <= RIVER.to) set(x, y, 'river');
      else set(x, y, isLand(x, y) ? 'land' : 'sea');
    }
  // Each AZ island: a pad with a one-tile channel round its three landward sides, so it reads as an island.
  for (const r of Object.values(reserved))
    for (let y = r.y - 1; y <= r.y + r.h; y++)
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        const inside = x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
        if (inside) set(x, y, 'island');
        else if (outside(x, y) > RIVER.to) set(x, y, 'sea');
      }

  // 2. The highway: from the gate east along its row to the edge of the map, on a causeway where it meets the sea,
  //    with land on both verges.
  const highway: Tile[] = [];
  for (let x = GRID; x <= RING_MAX; x++) {
    for (const dy of [-2, -1, 1, 2]) if (outside(x, HIGHWAY_ROW + dy) > RIVER.to && x > GRID - 1 + RIVER.to) set(x, HIGHWAY_ROW + dy, 'land');
    const d = outside(x, HIGHWAY_ROW);
    set(x, HIGHWAY_ROW, d >= RIVER.from && d <= RIVER.to ? 'bridge' : 'highway');
    highway.push({ x, y: HIGHWAY_ROW });
  }
  // The highway's far end runs into hills (the horizon): keep land round it.
  for (let y = HIGHWAY_ROW - 4; y <= HIGHWAY_ROW + 4; y++) for (let x = RING_MAX - 3; x <= RING_MAX; x++) if (get(x, y) === 'sea') set(x, y, 'land');

  // 3. Bridges where each core road line meets the river, if there's land (or an island slot) beyond it.
  const bridges: Bridge[] = [];
  const roads: (Tile & { axis: 'x' | 'y' })[] = [];
  const out = (side: Side, line: number, d: number): Tile =>
    side === 'N' ? { x: line, y: -d } : side === 'S' ? { x: line, y: GRID - 1 + d } : side === 'W' ? { x: -d, y: line } : { x: GRID - 1 + d, y: line };
  for (const side of ['N', 'W', 'S', 'E'] as Side[])
    for (const line of ROAD_LINES) {
      const axis = side === 'N' || side === 'S' ? 'y' : 'x';
      const beyond = out(side, line, RIVER.to + 1);
      const island = get(beyond.x, beyond.y) === 'island';
      if (!island && get(beyond.x, beyond.y) !== 'land') continue;
      // Not into the highway's verge.
      if (side === 'E' && Math.abs(line - HIGHWAY_ROW) <= 2) continue;
      const tiles: Tile[] = [];
      for (let d = RIVER.from; d <= RIVER.to; d++) {
        const t = out(side, line, d);
        set(t.x, t.y, 'bridge');
        tiles.push(t);
      }
      bridges.push({ side, line, axis, tiles });
      roads.push({ ...out(side, line, 1), axis });
      // An island's own short road in from its shore; else a country road on past the bridge for a few tiles.
      if (island) {
        for (let d = RIVER.to + 1; d <= RIVER.to + ISLAND_ROAD; d++) roads.push({ ...out(side, line, d), axis });
        continue;
      }
      const len = 2 + Math.floor(rng() * 5);
      for (let d = RIVER.to + 1; d <= RIVER.to + len; d++) {
        const t = out(side, line, d);
        if (get(t.x, t.y) !== 'land') break;
        roads.push({ ...t, axis });
      }
    }
  bridges.push({ side: 'E', line: HIGHWAY_ROW, axis: 'x', tiles: highway.filter((t) => get(t.x, t.y) === 'bridge'), highway: true });
  const roadAt = new Map(roads.map((t) => [idx(t.x, t.y), t.axis]));
  const isRoad = (x: number, y: number) => inRing(x, y) && roadAt.has(idx(x, y));
  const roadSprite = (x: number, y: number) => (roadAt.get(idx(x, y)) === 'x' ? 'roadX' : 'roadY');

  // 4. Beaches where land meets the sea, woods and fields inland.
  const seaNear = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => get(x + a, y + b) === 'sea');
  const cover = BIOME_COVER[biome];
  for (let y = RING_MIN; y <= RING_MAX; y++)
    for (let x = RING_MIN; x <= RING_MAX; x++) {
      if (get(x, y) !== 'land' || isRoad(x, y)) continue;
      const d = outside(x, y);
      const verge = Math.abs(y - HIGHWAY_ROW) <= 1 && x >= GRID;
      if (seaNear(x, y) && (biome !== 'boreal' ? fine(x, y) > 0.3 : fine(x, y) > 0.62)) set(x, y, 'beach');
      else if (inReserve(x, y) || verge || d <= RIVER.to + 1) continue;
      else if (woods(x, y) > cover.forest) set(x, y, 'forest');
      else if (farms(x, y) > cover.field && d >= 6) set(x, y, 'field');
    }

  // 5. Props, most important first, so the budget drops the least important ones.
  const props: TerrainProp[] = [];
  const used = new Set<number>();
  const free = (x: number, y: number, w: number, h: number, ok: (k: TerrainKind) => boolean) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (!inRing(i, j) || used.has(idx(i, j)) || isRoad(i, j) || !ok(get(i, j))) return false;
    return true;
  };
  const place = (p: TerrainProp) => {
    for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) used.add(idx(i, j));
    props.push(p);
  };

  // The gate arch over the highway where it leaves the core, then the bridges' decks.
  place({ sprite: 'gateArch', x: GRID, y: HIGHWAY_ROW - 1, w: 1, h: 3, role: 'gate' });
  for (const b of bridges) for (const t of b.tiles) place({ sprite: b.highway ? 'bridgeHighway' : b.axis === 'x' ? 'bridgeX' : 'bridgeY', x: t.x, y: t.y, w: 1, h: 1, role: 'bridge' });

  // The AZ islands (in zone order): data halls, a substation, cooling towers and the AZ's sign, fenced round the edge.
  const islands: Island[] = slots.map((slot) => {
    const r = reserved[slot];
    const side = slot[0] as 'N' | 'W';
    const at = (lx: number, ly: number) => ({ x: r.x + lx, y: r.y + ly });
    const kit: [string, number, number, number, number][] =
      side === 'N'
        ? [['pack:data_center:0', 0, 0, 3, 2], ['pack:data_center:0', 4, 0, 3, 2], ['pack:data_center:0', 0, 3, 3, 2], ['substation2x2', 4, 3, 2, 2], ['coolingTower', 6, 3, 1, 1], ['coolingTower', 6, 4, 1, 1], ['azSign', 4, 6, 2, 1]]
        : [['pack:data_center:0', 0, 0, 3, 2], ['pack:data_center:0', 4, 0, 3, 2], ['pack:data_center:0', 0, 4, 3, 2], ['substation2x2', 0, 2, 2, 2], ['coolingTower', 2, 2, 1, 1], ['coolingTower', 3, 2, 1, 1], ['azSign', 4, 5, 2, 1]];
    for (const [sprite, lx, ly, w, h] of kit) {
      const p = at(lx, ly);
      if (free(p.x, p.y, w, h, (k) => k === 'island')) place({ sprite, ...p, w, h, role: 'island' });
    }
    const road = roads.filter((t) => t.x >= r.x && t.y >= r.y && t.x < r.x + r.w && t.y < r.y + r.h).map(({ x, y }) => ({ x, y }));
    road.sort((a, b) => (side === 'N' ? b.y - a.y : b.x - a.x));
    // The fence runs along the island's edge (half a tile out from the edge tiles' centres), open where the road enters.
    const fences: Fence[] = [];
    for (let x = r.x; x < r.x + r.w; x++) {
      fences.push({ sprite: 'fenceX', x, y: r.y - 0.5 });
      if (!(side === 'N' && road.some((t) => t.x === x))) fences.push({ sprite: 'fenceX', x, y: r.y + r.h - 0.5 });
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      fences.push({ sprite: 'fenceY', x: r.x - 0.5, y });
      if (!(side === 'W' && road.some((t) => t.y === y))) fences.push({ sprite: 'fenceY', x: r.x + r.w - 0.5, y });
    }
    return { slot, side, rect: r, road, fences };
  });

  // Highway signs: the nearest Regions (and any the account links to), each with how far it is.
  const here = info ?? { lat, lon };
  const destinations: Destination[] = [...new Set([...linked.filter((c) => c !== region && regionInfo(c)), ...neighbours(region).map((r) => r.code)])]
    .slice(0, 3)
    .map((code) => {
      const r = regionInfo(code)!;
      return { code, city: r.city, km: Math.round(km(here, r)) };
    });
  destinations.forEach((dst, i) => {
    const x = GRID + RIVER.to + 3 + i * 4;
    if (x <= RING_MAX - 2) place({ sprite: 'highwaySign', x, y: HIGHWAY_ROW - 1, w: 1, h: 1, role: 'sign', to: dst.code });
  });

  // The Region's own landmark (its signature): on the open land nearest the front of the gate, where everyone
  // arriving looks (south-east of the highway, the front of the view), else the nearest open land at all. No rng()
  // here, so every other prop of every Region stays where it was.
  const sig = signatureFor(region);
  if (sig) {
    const ground = (k: TerrainKind) => k === 'land' || k === 'field' || k === 'forest';
    const aim = { x: GATE.x + 6, y: HIGHWAY_ROW + 4 };
    let at: Tile | undefined;
    let best = Infinity;
    for (let y = RING_MIN; y < RING_MAX; y++)
      for (let x = RING_MIN; x < RING_MAX; x++) {
        if (outside(x, y) <= RIVER.to || !free(x, y, 2, 2, ground) || inReserve(x, y) || inReserve(x + 1, y + 1)) continue;
        if (Math.abs(y - HIGHWAY_ROW) <= 1 || Math.abs(y + 1 - HIGHWAY_ROW) <= 1) continue; // off the highway's verge
        const d = Math.hypot(x - aim.x, y - aim.y);
        if (d < best) (best = d), (at = { x, y });
      }
    if (at) place({ sprite: signatureSprite(sig), ...at, w: 2, h: 2, role: 'signature', label: sig.label });
  }

  // re:Play Park (src/world/park.ts): a 6×5 site on open land near the signature, in front of the highway, off its
  // verge. Only reserved here (the game draws the rides as they open); no rng(), so nothing else moves for it.
  let park: Rect | undefined;
  {
    const ground = (k: TerrainKind) => k === 'land' || k === 'field' || k === 'forest' || k === 'beach';
    const aim = { x: GATE.x + 10, y: HIGHWAY_ROW + 5 };
    let best = Infinity;
    for (let y = RING_MIN; y <= RING_MAX - PARK_H + 1; y++)
      for (let x = RING_MIN; x <= RING_MAX - PARK_W + 1; x++) {
        if (outside(x, y) <= RIVER.to + 1 || !free(x, y, PARK_W, PARK_H, ground)) continue;
        if (y <= HIGHWAY_ROW + 1 && y + PARK_H - 1 >= HIGHWAY_ROW - 1) continue; // off the highway's verge
        let reservedHit = false;
        for (let j = y; j < y + PARK_H && !reservedHit; j++) for (let i = x; i < x + PARK_W; i++) if (inReserve(i, j)) (reservedHit = true);
        if (reservedHit) continue;
        const d = Math.hypot(x - aim.x, y - aim.y);
        if (d < best) (best = d), (park = { x, y, w: PARK_W, h: PARK_H });
      }
    if (park) for (let j = park.y; j < park.y + park.h; j++) for (let i = park.x; i < park.x + park.w; i++) used.add(idx(i, j));
  }

  // A lighthouse on the most exposed bit of coast, a pier off a beach.
  const coast: Tile[] = [];
  for (let y = RING_MIN + 1; y < RING_MAX; y++)
    for (let x = RING_MIN + 1; x < RING_MAX; x++) {
      const k = get(x, y);
      if ((k === 'beach' || k === 'land') && outside(x, y) >= 7 && !isRoad(x, y) && !inReserve(x, y)) coast.push({ x, y });
    }
  const exposure = (t: Tile) => {
    let n = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) n += get(t.x + i, t.y + j) === 'sea' ? 1 : 0;
    return n;
  };
  const ranked = coast.map((t) => ({ t, e: exposure(t) + rng() * 0.5 })).filter((c) => c.e >= 6).sort((a, b) => b.e - a.e);
  const light = ranked.find((c) => free(c.t.x, c.t.y, 1, 1, (k) => k === 'beach' || k === 'land'));
  if (light) place({ sprite: 'lighthouse', x: light.t.x, y: light.t.y, w: 1, h: 1, role: 'lighthouse' });
  const pierAt = ranked.find((c) => get(c.t.x, c.t.y) === 'beach' && (!light || Math.abs(c.t.x - light.t.x) + Math.abs(c.t.y - light.t.y) > 8));
  if (pierAt) {
    const t = pierAt.t;
    const dir = [[1, 0], [0, 1], [-1, 0], [0, -1]].find(([a, b]) => get(t.x + a, t.y + b) === 'sea' && get(t.x + 2 * a, t.y + 2 * b) === 'sea');
    if (dir) {
      const axis = dir[0] ? 'X' : 'Y';
      for (const s of [1, 2]) place({ sprite: `pier${axis}`, x: t.x + s * dir[0], y: t.y + s * dir[1], w: 1, h: 1 });
    }
  }

  // Hills on the horizon (the highway's end first), a farmhouse by the fields, a short row of wind turbines.
  const hill = `hill3x3:${biome}`;
  const horizon = { x: RING_MAX - 2, y: HIGHWAY_ROW - 4 };
  if (free(horizon.x, horizon.y, 3, 3, (k) => k !== 'sea')) place({ sprite: hill, ...horizon, w: 3, h: 3 });
  if (free(horizon.x, HIGHWAY_ROW + 2, 3, 3, (k) => k !== 'sea')) place({ sprite: hill, x: horizon.x, y: HIGHWAY_ROW + 2, w: 3, h: 3 });
  const spots: Tile[] = [];
  for (let y = RING_MIN; y <= RING_MAX - 2; y++) for (let x = RING_MIN; x <= RING_MAX - 2; x++) if (outside(x, y) >= 10) spots.push({ x, y });
  const shuffled = spots.map((t) => ({ t, r: rng() })).sort((a, b) => a.r - b.r).map((s) => s.t);
  let hills = 0;
  for (const t of shuffled) {
    if (hills >= 3) break;
    if (free(t.x, t.y, 3, 3, (k) => k === 'land' || k === 'forest') && !inReserve(t.x, t.y) && !inReserve(t.x + 2, t.y + 2)) place({ sprite: hill, ...t, w: 3, h: 3 }), hills++;
  }
  let farmhouses = 0;
  for (const t of shuffled) {
    if (farmhouses >= (biome === 'arid' ? 1 : 2)) break;
    const byField = [[-1, 0], [2, 0], [0, -1], [0, 2]].some(([a, b]) => get(t.x + a, t.y + b) === 'field');
    if (byField && free(t.x, t.y, 2, 2, (k) => k === 'land' || k === 'field')) place({ sprite: 'farmhouse', ...t, w: 2, h: 2 }), farmhouses++;
  }
  let turbines = 0;
  for (const t of shuffled) {
    if (turbines >= 3 || biome === 'tropical') break;
    const row = [0, 1, 2].map((k) => ({ x: t.x + k * 2, y: t.y }));
    if (row.every((r) => free(r.x, r.y, 1, 1, (k) => k === 'field' || k === 'land' || k === 'beach'))) {
      for (const r of row) place({ sprite: 'windTurbine0', ...r, w: 1, h: 1, role: 'turbine' });
      turbines = 3;
    }
  }

  // Suburbs: homes along the roads out of town and the highway (cottages, a few corner shops, terraces of
  // two), so people live somewhere beyond the landmarks. The same for a Region every time.
  const homeOk = (k: TerrainKind) => k === 'land' || k === 'field';
  const byStreet = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => isRoad(x + a, y + b) || get(x + a, y + b) === 'highway');
  let homes = 0;
  for (let y = RING_MIN; y <= RING_MAX && homes < SUBURB_HOMES; y++)
    for (let x = RING_MIN; x <= RING_MAX && homes < SUBURB_HOMES; x++) {
      if (outside(x, y) < RIVER.to + 2 || inReserve(x, y) || !byStreet(x, y) || rng() > 0.6) continue;
      const k = rng();
      if (k < 0.2 && free(x, y, 2, 1, homeOk) && !inReserve(x + 1, y)) place({ sprite: `house:terrace:${Math.floor(rng() * 3)}`, x, y, w: 2, h: 1, role: 'home' });
      else if (free(x, y, 1, 1, homeOk)) place({ sprite: k > 0.85 ? `house:shop:${Math.floor(rng() * 4)}` : `house:cottage:${Math.floor(rng() * 6)}`, x, y, w: 1, h: 1, role: 'home' });
      else continue;
      homes++;
    }

  // Woods: 3×3 clumps, then 2×2, then a few single trees, until the budget runs out.
  const forestOk = (k: TerrainKind) => k === 'forest';
  const budget = () => MAX_PROPS - props.length;
  for (const [w, sprite] of [[3, `forest3x3:${biome}`], [2, `forest2x2:${biome}`]] as const)
    for (let y = RING_MIN; y <= RING_MAX - w + 1 && budget() > 30; y++)
      for (let x = RING_MIN; x <= RING_MAX - w + 1 && budget() > 30; x++) if (free(x, y, w, w, forestOk)) place({ sprite, x, y, w, h: w });
  const trees = BIOME_TREES[biome];
  for (let y = RING_MIN; y <= RING_MAX && budget() > 0; y++)
    for (let x = RING_MIN; x <= RING_MAX && budget() > 0; x++) {
      const k = get(x, y);
      const p = k === 'forest' ? 0.7 : k === 'land' && outside(x, y) > RIVER.to + 1 ? 0.05 : k === 'beach' ? 0.03 : 0;
      if (p && rng() < p && free(x, y, 1, 1, () => true) && !inReserve(x, y)) {
        const sprite = k === 'beach' ? (biome === 'tropical' ? 'palm' : 'rock') : trees[Math.floor(rng() * trees.length)];
        place({ sprite, x, y, w: 1, h: 1 });
      }
    }

  // 6. Ground sprites for the bake.
  const ground = (x: number, y: number): string | undefined => {
    const k = get(x, y);
    const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    switch (k) {
      case 'island':
        return isRoad(x, y) ? roadSprite(x, y) : 'azPad';
      case 'core':
      case 'river':
      case 'sea':
      case 'bridge':
        return undefined;
      case 'promenade':
        return isRoad(x, y) ? roadSprite(x, y) : 'paver';
      case 'highway':
        return 'highwayX';
      case 'beach':
        return biome === 'boreal' ? 'shingle' : 'sand';
      case 'field':
        return farms(x + 40, y) > 0.5 ? 'field1' : 'field0';
      case 'forest':
        return `meadow:${biome}:1`;
      default:
        return isRoad(x, y) ? roadSprite(x, y) : `meadow:${biome}:${h % 5 === 0 ? 1 : 0}`;
    }
  };

  const left = cornerScreen(CITY_ISO, RING_MIN, RING_MAX + 1).x;
  const right = cornerScreen(CITY_ISO, RING_MAX + 1, RING_MIN).x;
  const top = cornerScreen(CITY_ISO, RING_MIN, RING_MIN).y - 64;
  const bottom = cornerScreen(CITY_ISO, RING_MAX + 1, RING_MAX + 1).y + 16;

  return {
    region,
    biome,
    kind: get,
    ground,
    props: props.slice(0, MAX_PROPS),
    roads,
    bridges,
    highway,
    gate: GATE,
    destinations,
    reserved,
    ...(park ? { park } : {}),
    islands,
    bounds: { x: left, y: top, w: right - left, h: bottom - top },
  };
}

/** Water the sea texture shows through (a bridge stands over the river). */
export const isWater = (k: TerrainKind) => k === 'sea' || k === 'river' || k === 'bridge';
