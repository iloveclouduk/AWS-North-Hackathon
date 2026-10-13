import Phaser from 'phaser';
import type { DataLink } from '@/backend/contract';
import { useCity } from '@/state/store';
import { REGIONS, WORLD_MAP, type Region } from '@/world/culture';
import { click } from '../audio';
import { reducedMotion } from '../motion';
import { SEA_COLOR, SEA_RGB } from '../palette';
import { crisp, TEXT_FONT } from '../SpeechBubble';
import { compare, perUnit, price, usd, regionFacts, separatePartition, partitionName, availability, friendlyRegionLine, signatureFor } from '@/world/regions';
import { isNightAt, markFromWorld, roads, skylineFor } from '../worldmap';
import { SERVICES } from '@/world/taxonomy';
import { ago, incidentsIn, worstByRegion } from '@/world/incidents';
import { builtCities } from '@/state/cities';
import { onSceneEnd } from './lifecycle';

/** The same blue the city sits in (palette.ts), so the dive fades from one sea into the other. */
const SEA = SEA_COLOR;
const LAND = 0x3f7d4f;
/** Shore pixels: lit on the north and west sides, shaded on the south and east (the city's light comes from the north-west too). */
const SHORE_LIT = 0x6aa86e;
const SHORE_SHADE = 0x2c5a3a;
const FOAM = 0xe8f6ff;
const GLINT = 0xa9d6f5;
const HIGHWAY = 0xe6f2ff;
const INK = 0x0f1114; // theme bgDeep
const DOT = 0xed7100;
/** Opt-in Regions the account hasn't turned on, and Regions in another partition. */
const OFF = 0x5d6878;
const CITY = 0xffd08a;
/** A city where it's night now: its skyline lit, with a warm glow round it. */
const CITY_LIT = 0xfff3c4;
const GLOW = 0xffc861;
/** v2.6: Regions with an open AWS Health event: red for a disruption, amber for degradation. */
const INCIDENT = { disruption: 0xe5676b, degradation: 0xe8c15a } as const;
const LINK: Record<DataLink['kind'], number> = { replication: 0xc925d1, standby: 0x7dd3fc, traffic: 0xffb84d };
/** The sea shimmers at about 6 fps, over at most this many cells near the coast. */
const SHIMMER_MS = 166;
const SHIMMER_MAX = 300;

/** West to east, for the arrow keys. */
const BY_LON = [...REGIONS.regions].sort((a, b) => a.lon - b.lon);

// ── The map's cells, worked out once (the mask never changes; only the cell size does) ─────────────────
type Run = { x: number; y: number; len: number };
const M = WORLD_MAP;
const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < M.cols && y < M.rows;
const land = (x: number, y: number) => M.mask[y]?.[x] === '#';
/** Off the map's edge counts as neither: no shore or foam along the map's own frame. */
const sea = (x: number, y: number) => inMap(x, y) && !land(x, y);
/** Cells where `pred` holds, merged into horizontal (or vertical) runs: one rectangle each instead of one per cell. */
function runs(pred: (x: number, y: number) => boolean, vertical = false): Run[] {
  const out: Run[] = [];
  const [outer, inner] = vertical ? [M.cols, M.rows] : [M.rows, M.cols];
  for (let a = 0; a < outer; a++) {
    let start = -1;
    for (let b = 0; b <= inner; b++) {
      const [x, y] = vertical ? [a, b] : [b, a];
      const on = b < inner && pred(x, y);
      if (on && start < 0) start = b;
      if (!on && start >= 0) {
        out.push(vertical ? { x: a, y: start, len: b - start } : { x: start, y: a, len: b - start });
        start = -1;
      }
    }
  }
  return out;
}
const LAND_RUNS = runs(land);
const SHORE = {
  n: runs((x, y) => land(x, y) && sea(x, y - 1)),
  s: runs((x, y) => land(x, y) && sea(x, y + 1)),
  w: runs((x, y) => land(x, y) && sea(x - 1, y), true),
  e: runs((x, y) => land(x, y) && sea(x + 1, y), true),
};
/** Sea cells within two cells of land, thinned evenly to SHIMMER_MAX, each with its own phase. */
const SHIMMER = (() => {
  const near: { x: number; y: number; phase: number }[] = [];
  for (let y = 0; y < M.rows; y++)
    for (let x = 0; x < M.cols; x++) {
      if (!sea(x, y)) continue;
      let coast = false;
      for (let dy = -2; dy <= 2 && !coast; dy++) for (let dx = -2; dx <= 2 && !coast; dx++) coast = land(x + dx, y + dy);
      if (coast) near.push({ x, y, phase: (((x * 73856093) ^ (y * 19349663)) >>> 0) % 628 / 100 });
    }
  const step = Math.ceil(near.length / SHIMMER_MAX);
  return near.filter((_, i) => i % step === 0);
})();

/** A 1px square outline from four rectangles (a stroked rect straddles pixels and blurs in pixel art). */
function frame(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
  g.fillRect(x, y, w, 1).fillRect(x, y + h - 1, w, 1).fillRect(x, y + 1, 1, h - 2).fillRect(x + w - 1, y + 1, 1, h - 2);
}

/**
 * The world map: every AWS Region as a dot, a little skyline where your account has a city (resources in that Region),
 * and arcs where data moves between Regions. Pick a Region and the camera dives into its city. Drawn in whole pixels
 * at a cell size that fits the panel, so it stays crisp without a fractional camera zoom.
 *
 * Calm but alive: the coast has shore pixels and foam, the sea near it glints (about 6 fps, a few hundred small
 * rectangles), cities breathe, and the focused Region shows faint highways to its neighbours. Under reduced motion
 * all of it is drawn once and holds still.
 */
export class WorldScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private shimmer!: Phaser.GameObjects.Graphics;
  private focusG!: Phaser.GameObjects.Graphics;
  private links!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private title!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private cell = 4;
  private origin = { x: 0, y: 0 };
  private focus?: Region;
  private packets: { link: DataLink; curve: Phaser.Curves.QuadraticBezier; t: number; back: boolean; dot: Phaser.GameObjects.Rectangle }[] = [];
  private linkLabels: Phaser.GameObjects.Text[] = [];
  private offs: (() => void)[] = [];
  private diving = false;
  /** The facts lines (AZs, opt-in, prices, bill, data flows) show only after "Facts ›". */
  private more = false;
  /** The last tap was a touch (one tap reads, a second visits); a mouse visits on click. */
  private touch = false;
  private moreBtn!: Phaser.GameObjects.Text;
  /** The Region tapped once: a second tap visits it (the first one only says what it is). */
  private armed?: string;
  /** City rings, and the suggested Region's ring on a first run (REGIONS.cityRegion), redrawn each frame. */
  private pulse!: Phaser.GameObjects.Graphics;
  private pulseT = 0;
  /** Where each city's skyline stands (worked out in draw, so update doesn't). */
  private cityPts: { x: number; y: number }[] = [];
  private shimmerMs = 0;
  private shimmerTick = 0;
  /** prefers-reduced-motion, read once per visit (not every frame). */
  private calm = false;

  constructor() {
    super('world');
  }

  create() {
    this.diving = false;
    this.calm = reducedMotion();
    markFromWorld();
    this.cameras.main.setBackgroundColor(SEA).setZoom(1).setScroll(0, 0).setRoundPixels(true);
    this.cameras.main.fadeIn(this.calm ? 0 : 250, ...SEA_RGB);
    this.g = this.add.graphics();
    this.shimmer = this.add.graphics().setDepth(1);
    this.focusG = this.add.graphics().setDepth(4);
    this.links = this.add.graphics().setDepth(5);
    this.more = false;
    this.armed = undefined;
    this.pulse = this.add.graphics().setDepth(8);
    this.title = crisp(
      this.add.text(10, 8, 'Choose a Region', { fontFamily: TEXT_FONT, fontSize: '14px', fontStyle: '800', color: '#fff8ee', stroke: '#15171b', strokeThickness: 3 }).setDepth(20).setScrollFactor(0),
    );
    // At the bottom: toasts appear over the top of the stage.
    this.info = crisp(
      this.add
        .text(10, 0, '', { fontFamily: TEXT_FONT, fontSize: '11px', fontStyle: '700', color: '#e6e2d8', backgroundColor: '#15171bcc', padding: { x: 6, y: 4 }, wordWrap: { width: 360 } })
        .setOrigin(0, 1)
        .setDepth(20)
        .setScrollFactor(0),
    );
    // "Facts ›": the facts behind the friendly line (also the M key).
    this.moreBtn = crisp(
      this.add
        .text(0, 0, 'Facts ›', { fontFamily: TEXT_FONT, fontSize: '11px', fontStyle: '800', color: '#ffd08a', backgroundColor: '#15171bcc', padding: { x: 6, y: 4 } })
        .setOrigin(1, 1)
        .setDepth(21)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true }),
    );
    this.moreBtn.on('pointerup', () => this.toggleMore());
    const s = useCity.getState();
    // A first run (no Region picked yet) starts with nothing focused: the suggested Region pulses instead.
    this.focus = s.prefs.region ? REGIONS.regions.find((r) => r.code === s.cityRegion) : undefined;
    this.draw();
    // Night moves round the world: re-light the skylines once a minute.
    this.time.addEvent({ delay: 60_000, loop: true, callback: () => this.draw() });
    this.scale.on('resize', this.draw, this);
    const off = useCity.subscribe((st, prev) => (st.inventory !== prev.inventory || st.bill !== prev.bill || st.prefs.mapDetails !== prev.prefs.mapDetails) && this.draw());
    this.offs.push(off, () => this.scale.off('resize', this.draw, this));

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (this.diving) return;
      if ((e.key === 'm' || e.key === 'M') && useCity.getState().prefs.region) this.toggleMore();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = Math.max(0, BY_LON.findIndex((r) => r.code === (this.focus?.code ?? REGIONS.cityRegion)));
        this.focus = BY_LON[(i + (e.key === 'ArrowRight' ? 1 : BY_LON.length - 1)) % BY_LON.length];
        this.draw();
      } else if ((e.key === 'Enter' || e.key === ' ') && this.focus) this.dive(this.focus);
    });
    onSceneEnd(this, () => this.teardown());
  }

  private teardown() {
    for (const off of this.offs) off();
    this.offs = [];
    this.input.keyboard?.removeAllListeners();
  }

  /** Where a Region sits on the map (whole pixels). */
  private at(r: { lat: number; lon: number }) {
    const x = ((r.lon - M.lonMin) / (M.lonMax - M.lonMin)) * M.cols * this.cell;
    const y = ((M.latMax - r.lat) / (M.latMax - M.latMin)) * M.rows * this.cell;
    return { x: Math.round(this.origin.x + x), y: Math.round(this.origin.y + y) };
  }

  /** Whether the account can use a Region: not in another partition, and (for opt-in Regions) turned on. */
  private status(code: string): 'enabled' | 'not-enabled' | 'partition' | undefined {
    if (separatePartition(code)) return 'partition';
    const inv = useCity.getState().inventory as { regionStatus?: Record<string, 'enabled' | 'not-enabled'> } | undefined;
    return inv?.regionStatus?.[code];
  }

  /** Regions with a city: where the account has resources, the city you're in, and the home Region. */
  private cities(): Record<string, number> {
    const s = useCity.getState();
    // A first look has no cities yet: every Region is just a glowing dot to pick.
    if (!s.prefs.region) return {};
    const counts = { ...(s.inventory?.regions ?? {}) };
    // Every Region the player has started a city in gets a little skyline too (src/state/cities.ts).
    for (const code of [s.cityRegion, s.inventory?.homeRegion ?? REGIONS.cityRegion, ...Object.keys(builtCities(s.progress))]) counts[code] ??= 0;
    return counts;
  }

  /** The land, its shore and foam: a few hundred merged rectangles, redrawn only on resize or new data. */
  private drawLand() {
    const c = this.cell;
    const o = this.origin;
    const g = this.g.clear();
    g.fillStyle(LAND, 1);
    for (const r of LAND_RUNS) g.fillRect(o.x + r.x * c, o.y + r.y * c, r.len * c, c);
    g.fillStyle(SHORE_LIT, 1);
    for (const r of SHORE.n) g.fillRect(o.x + r.x * c, o.y + r.y * c, r.len * c, 1);
    for (const r of SHORE.w) g.fillRect(o.x + r.x * c, o.y + r.y * c, 1, r.len * c);
    g.fillStyle(SHORE_SHADE, 1);
    for (const r of SHORE.s) g.fillRect(o.x + r.x * c, o.y + (r.y + 1) * c - 1, r.len * c, 1);
    for (const r of SHORE.e) g.fillRect(o.x + (r.x + 1) * c - 1, o.y + r.y * c, 1, r.len * c);
    // One pixel of foam on the sea side of every shore.
    g.fillStyle(FOAM, 0.55);
    for (const r of SHORE.n) g.fillRect(o.x + r.x * c, o.y + r.y * c - 1, r.len * c, 1);
    for (const r of SHORE.s) g.fillRect(o.x + r.x * c, o.y + (r.y + 1) * c, r.len * c, 1);
    for (const r of SHORE.w) g.fillRect(o.x + r.x * c - 1, o.y + r.y * c, 1, r.len * c);
    for (const r of SHORE.e) g.fillRect(o.x + (r.x + 1) * c, o.y + r.y * c, 1, r.len * c);
    return g;
  }

  /** Glints on the sea near the coast: each cell's own phase, so they twinkle rather than blink together. */
  private drawShimmer() {
    const g = this.shimmer.clear();
    const c = this.cell;
    const o = this.origin;
    const w = Math.max(1, c - 1);
    for (const s of SHIMMER) {
      const v = Math.sin(this.shimmerTick * 0.55 + s.phase);
      if (v < 0.5) continue;
      g.fillStyle(GLINT, 0.15 + (v - 0.5) * 0.7).fillRect(o.x + s.x * c, o.y + s.y * c + (c >> 1), w, 1);
    }
  }

  private draw() {
    const { width, height } = this.scale;
    this.cell = Math.max(2, Math.min(Math.floor((width - 12) / M.cols), Math.floor((height - 90) / M.rows)));
    this.origin = { x: Math.floor((width - M.cols * this.cell) / 2), y: Math.max(30, Math.floor((height - 50 - M.rows * this.cell) / 2) + 22) };
    this.info.setPosition(10, height - 10).setWordWrapWidth(width - 90);
    this.moreBtn.setPosition(width - 10, height - 10);
    const g = this.drawLand();
    this.drawShimmer();
    for (const t of this.texts) t.destroy();
    this.texts = [];
    this.cityPts = [];
    const cities = this.cities();
    const home = useCity.getState().inventory?.homeRegion ?? REGIONS.cityRegion;
    for (const r of REGIONS.regions) {
      const p = this.at(r);
      const hit = this.add.zone(p.x, p.y, 18, 18).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => ((this.focus = r), this.describe()));
      // Tap once to read about it, again to visit. With a mouse, the hover was the first look.
      hit.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        this.touch = pointer.wasTouch;
        if (this.armed === r.code || !pointer.wasTouch) return this.dive(r);
        this.armed = r.code;
        this.focus = r;
        this.time.delayedCall(0, () => this.draw()); // not while this hit zone's own event runs (draw remakes the zones)
      });
      this.texts.push(hit as unknown as Phaser.GameObjects.Text);
      if (r.code in cities) {
        // A tiny pixel skyline of the city's own landmark (its signature), on a dark rim so it reads on land and sea.
        const sky = skylineFor(signatureFor(r.code)?.motif);
        g.fillStyle(INK, 0.55);
        for (const [dx, dy, w, h] of sky) g.fillRect(p.x + dx - 1, p.y + dy - 1, w + 2, h + 2);
        const night = isNightAt(r.lon);
        if (night) {
          g.fillStyle(GLOW, 0.22);
          for (const [dx, dy, w, h] of sky) g.fillRect(p.x + dx - 2, p.y + dy - 2, w + 4, h + 4);
        }
        g.fillStyle(night ? CITY_LIT : CITY, 1);
        for (const [dx, dy, w, h] of sky) g.fillRect(p.x + dx, p.y + dy, w, h);
        this.cityPts.push(p);
        const n = cities[r.code];
        const label = crisp(
          this.add
            // The city's name (its code and resource count with map details on); nothing on a first look.
            .text(p.x, p.y + 6, !useCity.getState().prefs.region ? '' : useCity.getState().prefs.mapDetails ? `${r.code}${n ? ` · ${n}` : ''}${r.code === home ? ' ⌂' : ''}` : `${r.city}${r.code === home ? ' ⌂' : ''}`, { fontFamily: TEXT_FONT, fontSize: '9px', fontStyle: '800', color: '#ffd08a', backgroundColor: '#0d0816b3', padding: { x: 2, y: 1 } })
            .setOrigin(0.5, 0)
            .setDepth(10)
            .setVisible(!!useCity.getState().prefs.region),
        );
        this.texts.push(label);
      } else {
        const off = this.status(r.code) === 'not-enabled' || this.status(r.code) === 'partition';
        // A dark rim keeps the dot readable on land and sea alike.
        g.fillStyle(INK, 0.5).fillRect(p.x - 2, p.y - 2, 5, 5);
        g.fillStyle(off ? OFF : DOT, 1).fillRect(p.x - 1, p.y - 1, 3, 3);
        // One pip per Availability Zone under the dot (six for N. Virginia).
        const n = regionFacts(r.code)?.azIds.length ?? 0;
        for (let k = 0; k < n; k++) g.fillStyle(off ? OFF : 0xffd08a, 0.9).fillRect(p.x - n + 2 * k, p.y + 3, 1, 1);
      }
    }
    this.drawLinks();
    this.describe();
  }

  /** Arcs for data moving between Regions, each with a packet travelling along it. */
  private drawLinks() {
    const st = useCity.getState();
    // A first look is just glowing dots: the account's data links wait until there's a city (or map details are on).
    const shown = !!st.prefs.region || !!st.prefs.mapDetails;
    const links = shown ? (st.inventory?.links ?? []).filter((l) => l.from.region !== l.to.region) : [];
    this.links.clear();
    for (const p of this.packets) p.dot.destroy();
    for (const t of this.linkLabels) t.destroy();
    this.packets = [];
    this.linkLabels = [];
    for (const link of links) {
      const a = REGIONS.regions.find((r) => r.code === link.from.region);
      const b = REGIONS.regions.find((r) => r.code === link.to.region);
      if (!a || !b) continue;
      const curve = this.arc(a, b, 0.45);
      const pts = curve.getPoints(40);
      // A solid line you can see from across the room: a dark underlay, then the link's colour on top.
      for (const [w, color, alpha] of [[5, INK, 0.45], [2, LINK[link.kind], 1]] as const) {
        this.links.lineStyle(w, color, alpha);
        for (let i = 0; i < pts.length - 1; i++) this.links.lineBetween(Math.round(pts[i].x), Math.round(pts[i].y), Math.round(pts[i + 1].x), Math.round(pts[i + 1].y));
      }
      // What it is, at the top of the arc: "DynamoDB global table ⇄".
      const mid = curve.getPoint(0.5);
      const label = crisp(
        this.add
          .text(Math.round(mid.x), Math.round(mid.y) - 4, st.prefs.mapDetails ? `${link.label} ${link.twoWay ? '⇄' : '→'}` : link.twoWay ? '⇄' : '→', { fontFamily: TEXT_FONT, fontSize: '10px', fontStyle: '800', color: '#ffffff', backgroundColor: '#140d1fcc', padding: { x: 3, y: 1 } })
          .setOrigin(0.5, 1)
          .setDepth(7),
      );
      this.linkLabels.push(label);
      if (this.calm) continue;
      // Three packets a link, spaced out; a two-way link sends them both ways.
      for (let k = 0; k < 3; k++) {
        const back = !!link.twoWay && k % 2 === 1;
        const dot = this.add.rectangle(0, 0, 4, 4, LINK[link.kind]).setStrokeStyle(1, INK, 0.8).setDepth(6);
        this.packets.push({ link, curve, t: (k / 3 + Math.random() * 0.05) % 1, back, dot });
      }
    }
  }

  /** A curve lifted over the map between two Regions (more lift for longer hops, capped). */
  private arc(a: Region, b: Region, lift: number) {
    const p = this.at(a);
    const q = this.at(b);
    const h = Math.min(90, Math.hypot(q.x - p.x, q.y - p.y) * lift);
    return new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(p.x, p.y), new Phaser.Math.Vector2((p.x + q.x) / 2, Math.min(p.y, q.y) - h), new Phaser.Math.Vector2(q.x, q.y));
  }

  /** The focused Region: a white frame, and faint dashed highways to its neighbouring Regions. */
  private drawFocus() {
    const g = this.focusG.clear();
    const r = this.focus;
    if (!r) return;
    const p = this.at(r);
    g.lineStyle(1, HIGHWAY, 0.35);
    for (const n of roads(r.code)) {
      const pts = this.arc(r, n, 0.2).getPoints(20);
      for (let i = 0; i < pts.length - 1; i += 2) g.lineBetween(Math.round(pts[i].x), Math.round(pts[i].y), Math.round(pts[i + 1].x), Math.round(pts[i + 1].y));
    }
    g.fillStyle(0xffffff, 1);
    frame(g, p.x - 7, p.y - 8, 15, 15);
  }

  private toggleMore() {
    this.more = !this.more;
    this.describe();
  }

  /**
   * Each city breathes (a ring that grows and fades, out of step with the others), and on a first run a wider ring
   * shows the suggested Region, so a new player knows where to start. Drawn here rather than tweened: a handful of
   * rectangles a frame. Under reduced motion the rings hold still.
   */
  private drawPulses(time: number, dt: number) {
    const g = this.pulse.clear();
    if (this.diving) return;
    this.cityPts.forEach((p, i) => {
      const k = this.calm ? 0.5 : 0.5 + 0.5 * Math.sin(time / 650 + i * 1.7);
      const rad = 6 + Math.round(k * 3);
      g.fillStyle(CITY, 0.15 + 0.45 * (1 - k));
      frame(g, p.x - rad, p.y - 1 - rad, rad * 2 + 1, rad * 2 + 1);
    });
    // AWS Health: an affected Region throbs faster, in the incident's colour, with a second ring (no flashing).
    const worst = worstByRegion(useCity.getState().health);
    for (const [code, sev] of Object.entries(worst)) {
      if (sev === 'informational') continue;
      const reg = REGIONS.regions.find((x) => x.code === code);
      if (!reg) continue;
      const p = this.at(reg);
      const k = this.calm ? 0.5 : 0.5 + 0.5 * Math.sin(time / 320);
      for (const [base, a] of [
        [10, 1],
        [16, 0.6],
        [23, 0.3],
      ] as const) {
        const rad = base + Math.round(k * 4);
        g.fillStyle(INCIDENT[sev], a * (1 - k * 0.5));
        frame(g, p.x - rad, p.y - 1 - rad, rad * 2 + 1, rad * 2 + 1);
        frame(g, p.x - rad + 1, p.y - rad, rad * 2 - 1, rad * 2 - 1);
      }
    }
    if (useCity.getState().prefs.region) return;
    const r = REGIONS.regions.find((x) => x.code === REGIONS.cityRegion);
    if (!r) return;
    const p = this.at(r);
    this.pulseT = (this.pulseT + dt / 1400) % 1;
    const k = this.calm ? 0.5 : this.pulseT;
    const rad = Math.round(8 + k * 8);
    g.fillStyle(CITY, 1 - k * 0.8);
    frame(g, p.x - rad, p.y - rad, rad * 2 + 1, rad * 2 + 1);
  }

  override update(time: number, dt: number) {
    this.drawPulses(time, dt);
    if (this.calm) return;
    this.shimmerMs += dt;
    if (this.shimmerMs >= SHIMMER_MS) {
      this.shimmerMs %= SHIMMER_MS;
      this.shimmerTick++;
      this.drawShimmer();
    }
    for (const p of this.packets) {
      p.t = (p.t + dt / 3200) % 1;
      // Packets loop from source to destination; on a two-way link, every other one travels back.
      const t = p.back ? 1 - p.t : p.t;
      const pt = p.curve.getPoint(t);
      p.dot.setPosition(Math.round(pt.x), Math.round(pt.y));
    }
  }

  private describe() {
    this.drawFocus();
    const r = this.focus;
    // The facts wait until the player has a city: a first look is just "pick a dot".
    const veteran = !!useCity.getState().prefs.region;
    if (!veteran) this.more = false;
    this.moreBtn.setVisible(!!r && veteran).setText(this.more ? '‹ Less' : 'Facts ›');
    if (!r) return this.info.setText(veteran ? 'Pick a Region to visit its city.' : '').setVisible(veteran);
    this.info.setVisible(true);
    const visit = this.touch ? 'Tap again to visit.' : 'Click to visit.';
    const st = this.status(r.code);
    const hit = incidentsIn(useCity.getState().health, r.code).find((i) => i.region === r.code);
    const health = hit ? `${hit.severity === 'disruption' ? '⛈️ AWS reports a disruption here' : hit.severity === 'degradation' ? '🌧️ AWS reports trouble here' : 'ℹ️ AWS notice'} · updated ${ago(hit.updated)}` : '';
    const friendly = [health, friendlyRegionLine(r.code, st === 'not-enabled' ? 'not-enabled' : undefined), visit].filter(Boolean).join('\n');
    if (!this.more) return this.info.setText(friendly);
    const cities = this.cities();
    const links = (useCity.getState().inventory?.links ?? []).filter((l) => l.from.region !== l.to.region && (l.from.region === r.code || l.to.region === r.code));
    const f = regionFacts(r.code);
    const n = cities[r.code];
    const what = r.code in cities ? (n ? `${n} resource${n === 1 ? '' : 's'} here` : 'your city') : 'no resources here yet';
    const azs = f?.azIds.length ? `${f.azIds.length} AZs` : '';
    const access =
      st === 'partition' ? `${partitionName(r.code)}: needs its own account` : st === 'not-enabled' ? 'Opt-in Region, not turned on in your account' : f?.optIn ? 'Opt-in Region' : '';
    const t4g = price('ec2.t4g.micro', r.code);
    const vs = compare('ec2.t4g.micro', r.code);
    const cost = t4g ? `t4g.micro ${perUnit(t4g)}${vs ? ` (${Math.abs(vs)}% ${vs > 0 ? 'above' : 'below'} us-east-1)` : ''}` : '';
    const missing = SERVICES.filter((s) => availability(s.id, r.code).status !== 'available').length;
    const flow = links.length ? `Data to ${[...new Set(links.map((l) => (l.from.region === r.code ? l.to.region : l.from.region)))].join(', ')}` : '';
    const line1 = [r.name, r.code, azs].filter(Boolean).join(' · ');
    const line2 = [what, access, missing ? `${missing} of ${SERVICES.length} services not offered here` : 'every city service here'].filter(Boolean).join(' · ');
    const bill = useCity.getState().bill;
    const spent = bill && bill.unavailable === undefined ? `This month here: ${usd(bill.byRegion[r.code] ?? 0)}` : '';
    const line3 = [cost, spent, flow].filter(Boolean).join(' · ');
    this.info.setText([health, line1, line2, line3, this.touch ? 'Tap again or press Enter to zoom into its city.' : 'Click or press Enter to zoom into its city.'].filter(Boolean).join('\n'));
  }

  /**
   * The dive: the camera pans and zooms into the Region, then fades to the sea's blue, the same blue the city sits in.
   * The city then arrives from the side the camera came from (takeDiveFrom, CityScene.arrive).
   */
  private dive(r: Region) {
    if (this.diving) return;
    this.diving = true;
    click();
    this.focus = r;
    this.pulse.clear();
    const p = this.at(r);
    const cam = this.cameras.main;
    const done = () => useCity.getState().enterRegion(r.code);
    if (this.calm) return done();
    cam.pan(p.x, p.y, 550, 'Sine.easeIn');
    cam.zoomTo(6, 650, 'Sine.easeIn');
    this.time.delayedCall(300, () => cam.fadeOut(350, ...SEA_RGB));
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, done);
  }
}
