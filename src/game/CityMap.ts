import Phaser from 'phaser';
import type { Progress } from '@/backend/contract';
import { isDiscovered, tierOf } from '@/state/store';
import { BENCHES, FOUNTAIN, GRID, isRoad, LANDMARKS, plotAt, PLOT, ROAD, SITES, TOWN_SQUARE, type Tile } from '@/world/layout';
import { placeFor } from '@/world/places';
import { DISTRICTS, servicesIn, serviceById, type DistrictId } from '@/world/taxonomy';
import { addSprite, CITY_ATLAS, hasSprite, isPlaced } from './assets';
import { decorKey, decorPlan, siteGround, tileHash as hash, tilesOf, type DecorItem } from './decor';
import { cornerScreen, entityDepth, footprintDepth, toScreen, CITY_ISO } from './iso';
import { reducedMotion } from './motion';
import { frontRowTiles, TIER_PLAZA } from './TierProps';

const key = (x: number, y: number) => y * GRID + x;
/** Grid versions are unique across CityMaps, so a new scene's map never matches routes cached for an old one. */
let nextVersion = 1;

export interface LampRef {
  glow: Phaser.GameObjects.Image;
}

/** Ground tiles, roads, sidewalks and street furniture. Rebuilds tiles cheaply when progress changes. */
export class CityMap {
  private tiles: Phaser.GameObjects.Image[][] = [];
  private water: Phaser.GameObjects.Image[] = [];
  private props = new Map<number, Phaser.GameObjects.Image>();
  /** Progress-driven decor (parks, hoardings, lot signs, Day 1 / campus furniture), keyed by decorKey. */
  private decor = new Map<string, { item: DecorItem; img: Phaser.GameObjects.Image; glow?: Phaser.GameObjects.Image; lit?: Phaser.GameObjects.Image }>();
  /** Lit windows of decor (homes), over the night overlay like the landmarks'. */
  private windows = new Set<Phaser.GameObjects.Image>();
  /** Data-centre LED overlays (culture:dc:blink0/1) and the pack data hall's frames, stepped on the 450 ms tick. */
  private blinkers: Phaser.GameObjects.Image[] = [];
  private blinkFrame = 0;
  readonly blocked = new Set<number>();
  /** Bumped whenever decor blocks or frees tiles, so cached walking routes (RouteCache) are dropped. */
  blockedVersion = nextVersion++;
  readonly lamps: LampRef[] = [];
  private fountain?: Phaser.GameObjects.Image;
  private sidewalk = new Set<number>();
  private footprintOf = new Map<number, string>();

  constructor(private scene: Phaser.Scene) {
    for (const l of LANDMARKS.filter(isPlaced))
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
    this.buildBlinkers();
    scene.time.addEvent({ delay: 450, loop: true, callback: () => this.animate() });
  }

  isSidewalk = (x: number, y: number) => this.sidewalk.has(key(x, y)) || plotAt({ x, y }) === 'square';
  /** Walkable sidewalk tiles (the ring round each plot, plus the square), for citizens picking where to stroll. */
  sidewalkTiles(): Tile[] {
    const out: Tile[] = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (this.isSidewalk(x, y) && !this.blocked.has(key(x, y))) out.push({ x, y });
    return out;
  }
  isRoadTile = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID && y < GRID && isRoad({ x, y });

  /** Per-district open state for the progress being synced (cleared each sync), so 1,600 tiles ask once per district. */
  private openCache = new Map<DistrictId, boolean>();
  private openFor?: Progress;
  private openRegion?: string;
  /** What the ground last drew from: every district's open state and every landmark's tier (see groundSignature). */
  private groundSig?: string;

  /** The Region whose city this is (each Region builds its own: src/state/cities.ts). */
  private region = '';

  private districtOpen(p: Progress, d: DistrictId) {
    if (this.openFor !== p || this.openRegion !== this.region) {
      this.openFor = p;
      this.openRegion = this.region;
      this.openCache.clear();
    }
    let open = this.openCache.get(d);
    if (open === undefined) this.openCache.set(d, (open = servicesIn(d).some((s) => isDiscovered(p, s.id, this.region))));
    return open;
  }

  /**
   * Everything progress can change on the ground and in the decor: which districts are open and each landmark's tier.
   * XP that doesn't cross a tier, flashcards, quests and the rest leave it the same, so sync skips the tile pass.
   */
  private groundSignature(p: Progress) {
    let sig = '';
    for (const id of this.footprintIds) sig += `${tierOf(p, id, this.region)},`;
    for (const d of this.districts) sig += this.districtOpen(p, d) ? '1' : '0';
    return sig;
  }
  private footprintIds = [...new Set(LANDMARKS.filter(isPlaced).map((l) => l.id))].filter((id) => serviceById(id));
  private districts = DISTRICTS.map((d) => d.id);
  private globalIds = new Set(LANDMARKS.filter((l) => l.global).map((l) => l.id));
  /** The row in front of each service landmark's lot, by tile: paved as a plaza from Expert (TierProps). */
  private frontRow = new Map(LANDMARKS.filter((l) => serviceById(l.id)).flatMap((l) => frontRowTiles(l).map((t) => [key(t.x, t.y), l.id] as const)));

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
    if (plot === 'square') {
      // a green ring around the square, stone paths inside
      const r = TOWN_SQUARE.rect;
      const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
      return edge ? `grass${Math.floor(hash(x, y) * 3)}` : 'plazaStone';
    }
    if (this.sidewalk.has(key(x, y))) return 'sidewalk';
    const lmId = this.footprintOf.get(key(x, y));
    // A global service's lot (the Global Gate, on the campus) follows its tier whether or not its district is open.
    const global = plot === 'campus' && !!lmId && this.globalIds.has(lmId);
    if ((plot === 'day1' || plot === 'campus') && !global) return siteGround(plot, t);
    if (plot?.startsWith('future')) return 'sand';
    const d = plot as DistrictId;
    if (!global && !this.districtOpen(p, d)) return 'grassDark'; // a park behind hoardings until the district opens
    if (lmId && serviceById(lmId)) {
      const tier = tierOf(p, lmId, this.region);
      if (tier === 0) return 'dirt'; // construction site
      if (tier < 0) return 'lotPad'; // empty lot, not discovered yet
      const kind = placeFor(lmId)?.kind;
      const f = LANDMARKS.find((l) => l.id === lmId)!.footprint;
      if (kind === 'lake') return y === f.y + f.h - 1 ? 'sand' : 'water0';
      if (kind === 'dock' && y === f.y + f.h - 1) return 'water0';
      if (kind === 'garden') return 'grassDark';
    }
    const front = this.frontRow.get(key(x, y));
    if (front && plot !== 'campus' && tierOf(p, front, this.region) >= TIER_PLAZA) return 'plazaStone';
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
  sync(p: Progress, region: string) {
    this.region = region;
    const sig = this.groundSignature(p);
    if (sig === this.groundSig) return;
    this.groundSig = sig;
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
    this.syncDecor(p);
  }

  private waterFrame = 0;
  private animate() {
    this.waterFrame = (this.waterFrame + 1) % 4;
    for (const w of this.water) w.setFrame(`water${this.waterFrame}`);
    this.fountain?.setFrame(`fountain${this.waterFrame % 3}`);
    if (reducedMotion()) return; // LEDs hold still; water already moves slowly
    this.blinkFrame = (this.blinkFrame + 1) % 4;
    for (const b of this.blinkers)
      b.setFrame(b.frame.name.startsWith('pack:data_center') ? `pack:data_center:${this.blinkFrame}` : `culture:dc:blink${this.blinkFrame % 2}`);
  }

  /** LED overlays on each data centre (same anchor and footprint as its Landmark, drawn just above it). */
  private buildBlinkers() {
    if (!hasSprite('culture:dc:blink0')) return;
    for (const s of SITES.filter((l) => l.site?.sprite === 'culture:dc:0' && isPlaced(l))) {
      const f = s.footprint;
      const n = cornerScreen(CITY_ISO, f.x, f.y);
      this.blinkers.push(addSprite(this.scene, 'culture:dc:blink0', n.x, n.y).setDepth(footprintDepth(CITY_ISO, f) + 0.5));
    }
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
      if ((x + 2 * y) % 17 !== 0 || plotAt({ x, y }) === 'square') continue;
      this.placeProp('lamp', { x, y });
      const c = toScreen(CITY_ISO, x, y);
      const glow = addSprite(this.scene, 'glow', c.x, c.y - 50).setDepth(70_002).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      this.lamps.push({ glow });
    }
    // Town square: fountain, benches, flowers, trees, bins.
    this.fountain = this.placeProp('fountain0', FOUNTAIN);
    for (const b of BENCHES) this.placeProp('benchX', b, false); // citizens sit on them
    const r = TOWN_SQUARE.rect;
    for (const [dx, dy, name] of [[0, 0, 'tree0'], [r.w - 1, 0, 'tree1'], [0, r.h - 1, 'tree1'], [r.w - 1, r.h - 1, 'tree0'], [3, 1, 'flowers'], [8, 1, 'flowers'], [4, 7, 'flowers'], [9, 5, 'tree1'], [10, 8, 'bin'], [5, 10, 'plant'], [7, 10, 'plant'], [0, 5, 'tree0'], [11, 5, 'pine'], [5, 0, 'awsSign']] as const)
      this.placeProp(name, { x: r.x + dx, y: r.y + dy });
  }

  /**
   * Decor follows progress (src/game/decor.ts): trees in open districts, a hoarded park in locked ones (removed on
   * unlock), a sign on each undiscovered lot, and the Day 1 Quarter / campus furniture. Diffed, so a sync is cheap.
   */
  private syncDecor(p: Progress) {
    const plan = decorPlan({
      landmarks: LANDMARKS.filter(isPlaced),
      isSidewalk: (x, y) => this.sidewalk.has(key(x, y)),
      districtOpen: (d) => this.districtOpen(p, d),
      tierOf: (id) => tierOf(p, id, this.region),
    }).filter((d) => hasSprite(d.sprite));
    const want = new Map(plan.map((d) => [decorKey(d), d]));
    for (const [k, d] of this.decor) {
      if (want.has(k)) continue;
      d.img.destroy();
      d.glow?.destroy();
      if (d.lit) (this.windows.delete(d.lit), d.lit.destroy());
      if (d.glow) this.lamps.splice(this.lamps.findIndex((l) => l.glow === d.glow), 1);
      if (d.item.block) {
        for (const t of tilesOf(d.item)) if (!this.footprintOf.has(key(t.x, t.y))) this.blocked.delete(key(t.x, t.y));
        this.blockedVersion = nextVersion++;
      }
      this.blinkers = this.blinkers.filter((b) => b !== d.img);
      this.decor.delete(k);
    }
    for (const [k, item] of want) {
      if (this.decor.has(k)) continue;
      const n = cornerScreen(CITY_ISO, item.x, item.y);
      const img = addSprite(this.scene, item.sprite, n.x, n.y).setDepth(footprintDepth(CITY_ISO, item));
      if (item.block) {
        for (const t of tilesOf(item)) this.blocked.add(key(t.x, t.y));
        this.blockedVersion = nextVersion++;
      }
      let glow: Phaser.GameObjects.Image | undefined;
      if (item.glow) {
        const c = toScreen(CITY_ISO, item.x, item.y);
        glow = addSprite(this.scene, 'glow', c.x, c.y - 50).setDepth(70_002).setBlendMode(Phaser.BlendModes.ADD).setAlpha(this.night * 0.9);
        this.lamps.push({ glow });
      }
      let lit: Phaser.GameObjects.Image | undefined;
      if (hasSprite(`${item.sprite}@lights`)) {
        lit = addSprite(this.scene, `${item.sprite}@lights`, n.x, n.y).setDepth(70_001).setBlendMode(Phaser.BlendModes.ADD).setAlpha(this.night);
        this.windows.add(lit);
      }
      if (item.sprite.startsWith('pack:data_center')) this.blinkers.push(img);
      this.decor.set(k, { item, img, glow, lit });
    }
  }

  private night = 0;
  setNight(n: number) {
    this.night = n;
    for (const l of this.lamps) l.glow.setAlpha(n * 0.9);
    for (const w of this.windows) w.setAlpha(n);
  }
}
