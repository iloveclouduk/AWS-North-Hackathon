import Phaser from 'phaser';
import type { Progress } from '@/backend/contract';
import { isDiscovered, tierOf } from '@/state/store';
import { BENCHES, DISTRICT_PLOTS, FOUNTAIN, GRID, inRect, isRoad, LANDMARKS, plotAt, PLOT, ROAD, TOWN_SQUARE, type Tile } from '@/world/layout';
import { placeFor } from '@/world/places';
import { servicesIn, serviceById, type DistrictId } from '@/world/taxonomy';
import { addSprite, CITY_ATLAS } from './assets';
import { cornerScreen, entityDepth, toScreen, CITY_ISO } from './iso';

const key = (x: number, y: number) => y * GRID + x;
const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface LampRef {
  glow: Phaser.GameObjects.Image;
}

/** Ground tiles, roads, sidewalks and street furniture. Rebuilds tiles cheaply when progress changes. */
export class CityMap {
  private tiles: Phaser.GameObjects.Image[][] = [];
  private water: Phaser.GameObjects.Image[] = [];
  private props = new Map<number, Phaser.GameObjects.Image>();
  readonly blocked = new Set<number>();
  readonly lamps: LampRef[] = [];
  private fountain?: Phaser.GameObjects.Image;
  private sidewalk = new Set<number>();
  private footprintOf = new Map<number, string>();

  constructor(private scene: Phaser.Scene) {
    for (const l of LANDMARKS)
      for (let y = l.footprint.y; y < l.footprint.y + l.footprint.h; y++)
        for (let x = l.footprint.x; x < l.footprint.x + l.footprint.w; x++) {
          this.blocked.add(key(x, y));
          this.footprintOf.set(key(x, y), l.id);
        }
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        if (isRoad({ x, y }) || this.footprintOf.has(key(x, y))) continue;
        const nearRoad = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isRoad({ x: x + dx, y: y + dy }));
        if (nearRoad) this.sidewalk.add(key(x, y));
      }
    this.buildTiles();
    this.buildStreetFurniture();
    scene.time.addEvent({ delay: 450, loop: true, callback: () => this.animate() });
  }

  isSidewalk = (x: number, y: number) => this.sidewalk.has(key(x, y)) || plotAt({ x, y }) === 'square';
  isRoadTile = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID && y < GRID && isRoad({ x, y });

  private districtOpen(p: Progress, d: DistrictId) {
    return servicesIn(d).some((s) => isDiscovered(p, s.id));
  }

  groundKey(t: Tile, p: Progress): string {
    const { x, y } = t;
    if (isRoad(t)) {
      const rx = x % (PLOT + ROAD) === 0;
      const ry = y % (PLOT + ROAD) === 0;
      if (rx && ry) return 'road';
      const m = PLOT + ROAD;
      if (rx) return y % m === 1 || y % m === m - 1 ? 'zebraX' : 'roadY';
      return x % m === 1 || x % m === m - 1 ? 'zebraY' : 'roadX';
    }
    const plot = plotAt(t);
    if (plot === 'square') return 'plaza';
    if (this.sidewalk.has(key(x, y))) return 'sidewalk';
    if (plot?.startsWith('future')) return 'sand';
    const d = plot as DistrictId;
    if (!this.districtOpen(p, d)) return 'dirt';
    const lmId = this.footprintOf.get(key(x, y));
    if (lmId && serviceById(lmId)) {
      const tier = tierOf(p, lmId);
      if (tier === 0) return 'dirt'; // construction site
      if (tier < 0) return `grass${Math.floor(hash(x, y) * 3)}`; // empty lot, not discovered yet
      const kind = placeFor(lmId)?.kind;
      const f = LANDMARKS.find((l) => l.id === lmId)!.footprint;
      if (kind === 'lake') return y === f.y + f.h - 1 ? 'sand' : 'water0';
      if (kind === 'dock' && y === f.y + f.h - 1) return 'water0';
      if (kind === 'garden') return 'grassDark';
    }
    return `grass${Math.floor(hash(x, y) * 3)}`;
  }

  private buildTiles() {
    for (let y = 0; y < GRID; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < GRID; x++) {
        const n = cornerScreen(CITY_ISO, x, y);
        const img = this.scene.add.image(n.x, n.y, CITY_ATLAS, 'grass0').setOrigin(0.5, 0).setDepth(x + y);
        this.tiles[y][x] = img;
        if (x === GRID - 1) addSprite(this.scene, 'edgeR', n.x, n.y).setDepth(-1);
        if (y === GRID - 1) addSprite(this.scene, 'edgeL', n.x, n.y).setDepth(-1);
      }
    }
  }

  /** Update ground to match progress (districts unlocking, lakes filling as S3 grows…). */
  sync(p: Progress) {
    this.water = [];
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        const k = this.groundKey({ x, y }, p);
        const img = this.tiles[y][x];
        if (k.startsWith('water')) {
          this.water.push(img);
          if (!img.frame.name.startsWith('water')) img.setFrame(`water${this.waterFrame}`);
        } else if (img.frame.name !== k) img.setFrame(k);
      }
    this.syncTrees(p);
  }

  private waterFrame = 0;
  private animate() {
    this.waterFrame = (this.waterFrame + 1) % 4;
    for (const w of this.water) w.setFrame(`water${this.waterFrame}`);
    this.fountain?.setFrame(`fountain${this.waterFrame % 3}`);
  }

  private placeProp(name: string, t: Tile, block = true) {
    const n = cornerScreen(CITY_ISO, t.x, t.y);
    const img = addSprite(this.scene, name, n.x, n.y).setDepth(entityDepth(toScreen(CITY_ISO, t.x, t.y).y));
    if (block) this.blocked.add(key(t.x, t.y));
    this.props.set(key(t.x, t.y), img);
    return img;
  }

  private buildStreetFurniture() {
    // Street lamps every few sidewalk tiles.
    for (const k of this.sidewalk) {
      const x = k % GRID;
      const y = Math.floor(k / GRID);
      if ((x + 2 * y) % 11 !== 0 || plotAt({ x, y }) === 'square') continue;
      this.placeProp('lamp', { x, y });
      const c = toScreen(CITY_ISO, x, y);
      const glow = addSprite(this.scene, 'glow', c.x, c.y).setDepth(9_500).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      this.lamps.push({ glow });
    }
    // Town square: fountain, benches, flowers, trees, bins.
    this.fountain = this.placeProp('fountain0', FOUNTAIN);
    for (const b of BENCHES) this.placeProp('benchX', b, false); // citizens sit on them
    const r = TOWN_SQUARE.rect;
    for (const [dx, dy, name] of [[0, 0, 'tree0'], [r.w - 1, 0, 'tree1'], [0, r.h - 1, 'tree2'], [r.w - 1, r.h - 1, 'tree0'], [5, 5, 'flowers'], [7, 5, 'flowers'], [5, 7, 'flowers'], [9, 6, 'bin']] as const)
      this.placeProp(name, { x: r.x + dx, y: r.y + dy });
  }

  /** Trees and bushes fill empty grass in open districts; locked plots get scrub. */
  private syncTrees(p: Progress) {
    for (const [id, d] of Object.entries(DISTRICT_PLOTS)) {
      const open = this.districtOpen(p, id as DistrictId);
      const rr = d.rect;
      for (let y = rr.y; y < rr.y + rr.h; y++)
        for (let x = rr.x; x < rr.x + rr.w; x++) {
          const k = key(x, y);
          if (this.footprintOf.has(k) || this.sidewalk.has(k) || LANDMARKS.some((l) => l.workSpot.x === x && l.workSpot.y === y)) continue;
          if (LANDMARKS.some((l) => inRect({ x, y: y - 1 }, l.footprint))) continue; // keep the row in front of buildings clear
          const h = hash(x, y, 7);
          const want = open ? (h < 0.1 ? ['tree0', 'tree1', 'tree2', 'pine'][Math.floor(h * 40)] : h > 0.95 ? 'flowers' : undefined) : h < 0.06 ? 'bush' : undefined;
          const cur = this.props.get(k);
          if (cur && cur.frame.name === want) continue;
          if (cur) {
            cur.destroy();
            this.props.delete(k);
            this.blocked.delete(k);
          }
          if (want) this.placeProp(want, { x, y });
        }
    }
  }

  setNight(n: number) {
    for (const l of this.lamps) l.glow.setAlpha(n * 0.9);
  }
}
