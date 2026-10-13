import Phaser from 'phaser';
import type { DataLink, FlowRate } from '@/backend/contract';
import { bus } from '@/state/bus';
import { useCity, type Inventory } from '@/state/store';
import { REGIONS } from '@/world/culture';
import { azCounts, azIndex, azsFor, GATE, GRID, landmarkLayout, type AzIsland } from '@/world/layout';
import { perUnit, price, regionFacts, zonesFor } from '@/world/regions';
import { CARRIER_FOR, carsPerMinute, type Cargo, type CarrierKind } from '@/world/carriers';
import { RING_MAX, terrainFor, type Terrain } from '@/world/terrain';
import { click } from './audio';
import { cornerScreen, toScreen, type Iso } from './iso';
import { reducedMotion } from './motion';
import type { Packets } from './Packets';
import { RoadGraph, type Pt } from './RoadGraph';
import { keepTextInView } from './labels';
import { crisp, TEXT_FONT } from './SpeechBubble';
import { CSS, LABEL_BG, withAlpha } from './theme';

const COLORS: Record<DataLink['kind'], number> = { replication: 0xc925d1, standby: 0x7dd3fc, traffic: 0xffb84d };
/** Labels and notes sit above every standing thing (props and landmarks are 10,000 + screen y; their signs 40,000). */
const LABEL_DEPTH = 40_100;
/** The "AWS global network" fibre runs beside the highway, on its north verge (grid y offset from the highway's row). */
const FIBRE_DY = -0.8;
/** The middle of downtown: Region traffic with no AZ of its own starts from the junction nearest here. */
const DOWNTOWN: Pt = { x: GRID / 2, y: GRID / 2 };
/** How far a pointer may move between down and up and still count as a click (not a drag of the camera), px. */
const CLICK_SLOP = 8;
/**
 * A data link plays every few seconds: as a data carrier on the roads (dispatch), or, when one can't drive now, as a
 * convoy of packets slower than an agent's message (so the eye can follow it).
 */
const LINK_EVERY_MS = 4_500;
const LINK_HOP_MS = 120;
const CONVOY = 3;
const CONVOY_GAP_MS = 260;
/** "Zone A": a friendly island name, from the account's AZ name suffix (us-west-2a → A), else the island's order. */
export const zoneLetter = (az: { name?: string }, i: number) => {
  const m = az.name?.match(/\d([a-z])$/);
  return (m ? m[1] : String.fromCharCode(97 + (i % 26))).toUpperCase();
};
/** Labels a passing note must not cover: the island and Region labels here, and the highway signs (Landscape, 40,000). */
const isLabel = (o: Phaser.GameObjects.GameObject): o is Phaser.GameObjects.Text =>
  o instanceof Phaser.GameObjects.Text && o.visible && o.depth >= 40_000 && o.depth <= LABEL_DEPTH;

/**
 * The city is one AWS Region. Its real Availability Zones (six in us-east-1, four in us-west-2, three in most) are
 * islands across the river (terrain.ts builds them; Landscape.ts draws them), each labelled here with its AZ ID, the
 * account's name for it when known, and how many of the player's resources stand in it. Tapping an island opens the
 * Region facts (the 'regionsign' card). Data links from the account drive as data carriers (a replication tanker, a
 * standby van, a request car): between AZs over both islands' bridges through downtown, and to other Regions out along
 * the highway beside the AWS global network's fibre. Tapping one says what it carries and what that transfer costs.
 */
export class RegionOverlay {
  private g: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private notes: Phaser.GameObjects.Text[] = [];
  private hits: Phaser.GameObjects.Zone[] = [];
  private islandLabels: Phaser.GameObjects.Text[] = [];
  /** Where each island label belongs (world px), before it's kept inside the view (keepInView). */
  private islandAnchors: Pt[] = [];
  private region = '';
  private zones?: { name: string; id: string }[];
  private islands: AzIsland[] = [];
  private links: DataLink[] = [];
  private timer?: Phaser.Time.TimerEvent;
  private next = 0;
  private ui = 1;
  private graph?: RoadGraph;
  private graphOf?: Terrain;
  private counts = '';
  /** v2.6: zone IDs AWS's Health Dashboard names in an open event here. */
  private outageAzs = new Set<string>();
  /** "Show the map details": AZ IDs, resource counts, the network label, link notes and the Region line. Off by default. */
  private details = false;
  /** The island under the pointer (its label shows the real names), and whether the Region sign is hovered. */
  private hoveredIsland = -1;
  private regionHover = false;
  private nameLabel?: Phaser.GameObjects.Text;
  private nameAnchor?: Pt;
  private netLabel?: Phaser.GameObjects.Text;
  /** Tapping an island (its ground or its "Zone A" label) also calls this, with the island's index (the drill offer). */
  onIslandTap?: (i: number) => void;
  /** v2.8: live traffic (city.flow): request cars due per source, and the 1-second clock that sends them. */
  private flow: FlowRate[] = [];
  private flowDue = new Map<string, number>();
  private flowTimer?: Phaser.Time.TimerEvent;
  /** Sends a data carrier along the roads (Ambient.dispatchData); false when it can't drive now (then: packets). */
  dispatch?: (kind: CarrierKind, from: Pt | 'highway', to: Pt | 'highway', cargo: Cargo) => boolean;

  /**
   * `terrain`: the landscape the scene built (Landscape.terrain), so the link packets ride the same roads the traffic
   * does. Without it the overlay builds the same (deterministic) terrain itself.
   */
  constructor(
    private scene: Phaser.Scene,
    private iso: Iso,
    private packets: Packets,
    private terrain?: () => Terrain | undefined,
  ) {
    // Over the baked ground, under everything standing: the fibre line beside the highway.
    this.g = scene.add.graphics().setDepth(1);
  }

  /** The Region, and the account's AZ name → AZ ID mapping there when known. Also refreshes the per-island counts. */
  setRegion(code: string, zones?: { name: string; id: string }[]) {
    if (code !== this.region || JSON.stringify(zones ?? null) !== JSON.stringify(this.zones ?? null)) {
      this.region = code;
      this.zones = zones;
      this.graph = undefined;
      this.graphOf = undefined;
      this.draw();
    }
    this.syncCounts();
  }

  /** v2.6: AWS reports trouble in these zones (by AZ ID): their islands say so. */
  setOutageAzs(ids: string[]) {
    const next = new Set(ids);
    if (next.size === this.outageAzs.size && [...next].every((id) => this.outageAzs.has(id))) return;
    this.outageAzs = next;
    this.counts = '';
    this.syncCounts();
  }

  /** The screen centre of each island AWS reports trouble on (Weather puts a cloud there). */
  outageSpots(): { x: number; y: number }[] {
    return this.islands
      .filter((az) => this.outageAzs.has(az.id))
      .map((az) => {
        const c = cornerScreen(this.iso, az.rect.x + az.rect.w / 2, az.rect.y + az.rect.h / 2);
        return { x: c.x, y: c.y - 40 };
      });
  }

  /** The account's data links: only those touching this Region play here. */
  setLinks(links: DataLink[] = []) {
    this.links = links.filter((l) => l.from.region === this.region || l.to.region === this.region);
    this.timer?.remove();
    this.timer = undefined;
    if (!this.links.length || reducedMotion()) return;
    this.next = 0;
    this.timer = this.scene.time.addEvent({ delay: LINK_EVERY_MS, loop: true, startAt: LINK_EVERY_MS - 1_500, callback: () => this.playNext() });
  }

  /**
   * v2.8: the account's live request counts. Each rate sends request cars in from the highway at carsPerMinute: the
   * load balancer's to the AZ islands that served them, the rest to their service's building. Rates for another
   * Region don't play here.
   */
  setFlow(rates: FlowRate[], region?: string) {
    this.flow = region === this.region ? rates : [];
    for (const k of [...this.flowDue.keys()]) if (!this.flow.some((r) => k.startsWith(`${r.id}:`))) this.flowDue.delete(k);
    if (!this.flow.length) {
      this.flowTimer?.remove();
      this.flowTimer = undefined;
      return;
    }
    this.flowTimer ??= this.scene.time.addEvent({ delay: 1_000, loop: true, callback: () => this.playFlow() });
  }

  private playFlow() {
    if (!this.dispatch || (typeof document !== 'undefined' && document.hidden)) return;
    for (const r of this.flow) {
      const targets: { key: string; perMin: number; to: Pt; route: string }[] = [];
      if (r.byAz) {
        for (const [az, perMin] of Object.entries(r.byAz)) {
          const i = azIndex(this.islands, az);
          if (i !== undefined) targets.push({ key: `${r.id}:${az}`, perMin, to: this.islands[i].bridge.end, route: `Internet → Zone ${zoneLetter(this.islands[i], i)}` });
        }
      } else {
        const l = landmarkLayout(r.serviceId);
        if (l) targets.push({ key: `${r.id}:`, perMin: r.perMin, to: l.workSpot, route: `Internet → ${r.label}` });
      }
      for (const t of targets) {
        const due = (this.flowDue.get(t.key) ?? Math.random()) + carsPerMinute(t.perMin) / 60;
        if (due < 1) {
          this.flowDue.set(t.key, due);
          continue;
        }
        const sent = this.dispatch('request', 'highway', t.to, { kind: 'request', label: `${r.label}: about ${t.perMin.toLocaleString()} a minute`, route: t.route });
        this.flowDue.set(t.key, sent ? due - 1 : Math.min(due, 1));
      }
    }
  }

  setUiScale(ui: number) {
    this.ui = ui;
    for (const t of [...this.texts, ...this.notes, ...this.islandLabels]) t.setScale(ui);
  }

  /** The "Show the map details" setting (prefs.mapDetails). */
  setDetails(on: boolean) {
    if (on === this.details) return;
    this.details = on;
    if (!on) for (const n of this.notes) n.destroy();
    if (!on) this.notes = [];
    this.syncVisibility();
    this.counts = '';
    this.syncCounts();
  }

  /** Pointing at the Region sign on the campus: the Region line shows. */
  setRegionHover(on: boolean) {
    if (on === this.regionHover) return;
    this.regionHover = on;
    this.syncVisibility();
  }

  private syncVisibility() {
    this.nameLabel?.setVisible(this.details || this.regionHover);
    this.netLabel?.setVisible(this.details);
  }

  private hoverIsland(i: number, on: boolean) {
    // The label is rebuilt under the pointer (and gets its own pointerover): only a real change redraws.
    const next = on ? i : this.hoveredIsland === i ? -1 : this.hoveredIsland;
    if (next === this.hoveredIsland) return;
    this.hoveredIsland = next;
    this.syncCounts();
  }

  /**
   * Per frame from CityScene: a label near the edge of the view (the islands at the top of the default framing) slides
   * in to stay whole instead of being clipped; one far off-screen stays where it is.
   * `topInset`: screen px at the top of the view that the UI covers (the AWS status ticker), kept clear of labels.
   */
  keepInView(view: Phaser.Geom.Rectangle, topInset = 0) {
    if (!view.width) return;
    this.islandLabels.forEach((t, i) => this.islandAnchors[i] && keepTextInView(t, this.islandAnchors[i], view, this.ui, topInset));
    if (this.nameLabel && this.nameAnchor) keepTextInView(this.nameLabel, this.nameAnchor, view, this.ui, topInset);
  }

  destroy() {
    this.timer?.remove();
    this.flowTimer?.remove();
    this.g.destroy();
    for (const t of [...this.texts, ...this.notes, ...this.islandLabels]) t.destroy();
    for (const h of this.hits) h.destroy();
  }

  /** The islands drawn now (for tests and the scene). */
  get azIslands(): readonly AzIsland[] {
    return this.islands;
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  private text(x: number, y: number, text: string, color: string, into: Phaser.GameObjects.Text[], size = 11) {
    const txt = crisp(
      this.scene.add
        .text(Math.round(x), Math.round(y), text, { fontFamily: TEXT_FONT, fontSize: `${size}px`, fontStyle: '800', align: 'center', color, backgroundColor: LABEL_BG, padding: { x: 5, y: 2 } })
        .setOrigin(0.5)
        .setDepth(LABEL_DEPTH)
        .setScale(this.ui),
    );
    into.push(txt);
    return txt;
  }

  private label(t: Pt, text: string, color: string, into = this.texts) {
    const c = toScreen(this.iso, t.x, t.y);
    return this.text(c.x, c.y, text, color, into);
  }

  /** Open the Region facts card, as the Region sign on the campus does. */
  private openFacts = () => {
    click();
    useCity.getState().select('regionsign');
    bus.emit('select', { id: 'regionsign' });
  };

  /** A tap (not a camera drag) on a game object opens the Region facts (and, on an island, tells the scene which). */
  private tappable(o: Phaser.GameObjects.GameObject, island?: number) {
    o.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (Math.hypot(p.upX - p.downX, p.upY - p.downY) > CLICK_SLOP) return;
      this.openFacts();
      if (island !== undefined) this.onIslandTap?.(island);
    });
  }

  /** AWS's Health Dashboard reports trouble on island i (no practice drill there, then). */
  isOutage(i: number) {
    const az = this.islands[i];
    return !!az && this.outageAzs.has(az.id);
  }

  /** "A", "B"…: island i's letter, as its label shows it. */
  letter(i: number) {
    const az = this.islands[i];
    return az ? zoneLetter(az, i) : String.fromCharCode(65 + i);
  }

  /** Island i's label as drawn now (it's rebuilt on hover, so ask each time), for things shown just under it. */
  labelOf(i: number): Phaser.GameObjects.Text | undefined {
    return this.islandLabels[i];
  }

  /** Where island i's label belongs (world px), before it's kept in view. */
  labelAt(i: number): Pt | undefined {
    const az = this.islands[i];
    if (!az) return undefined;
    const top = cornerScreen(this.iso, az.rect.x, az.rect.y);
    return { x: Math.round(top.x), y: Math.round(top.y - 50) };
  }

  private draw() {
    this.g.clear();
    for (const t of [...this.texts, ...this.islandLabels]) t.destroy();
    for (const h of this.hits) h.destroy();
    this.texts = [];
    this.islandLabels = [];
    this.islandAnchors = [];
    this.hits = [];
    this.counts = '';
    this.hoveredIsland = -1;
    this.islands = azsFor(this.region, this.zones);

    // Each island: an invisible tap target over its diamond (the label is drawn by syncCounts); pointing at it shows
    // its real names.
    this.islands.forEach((az, i) => {
      const r = az.rect;
      const pts = [cornerScreen(this.iso, r.x, r.y), cornerScreen(this.iso, r.x + r.w, r.y), cornerScreen(this.iso, r.x + r.w, r.y + r.h), cornerScreen(this.iso, r.x, r.y + r.h)];
      const minX = Math.min(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxX = Math.max(...pts.map((p) => p.x));
      const maxY = Math.max(...pts.map((p) => p.y));
      const poly = new Phaser.Geom.Polygon(pts.map((p) => new Phaser.Math.Vector2(p.x - minX, p.y - minY)));
      const zone = this.scene.add.zone(minX, minY, maxX - minX, maxY - minY).setOrigin(0).setDepth(2);
      zone.setInteractive({ hitArea: poly, hitAreaCallback: Phaser.Geom.Polygon.Contains, useHandCursor: true });
      zone.on('pointerover', () => this.hoverIsland(i, true));
      zone.on('pointerout', () => this.hoverIsland(i, false));
      this.tappable(zone, i);
      this.hits.push(zone);
    });

    // The Region's name, in front of the city at its south corner (by the campus and its Region sign): nothing tall
    // stands there, so it's never hidden behind a bridge or an island.
    const r = REGIONS.regions.find((x) => x.code === this.region);
    const f = regionFacts(this.region);
    const count = f?.azIds.length ? `${f.azIds.length} AZs` : this.islands.length ? `${this.islands.length} AZs` : '';
    const name = this.label({ x: GRID + 0.6, y: GRID + 0.6 }, ['AWS Region', r ? `${r.city} · ${r.code}` : this.region, count].filter(Boolean).join(' · '), CSS.accent);
    name.setInteractive({ useHandCursor: true });
    this.tappable(name);
    this.nameLabel = name;
    this.nameAnchor = { x: name.x, y: name.y };

    // The AWS global network: a faint fibre beside the highway, from the gate to the horizon.
    const y = GATE.y + FIBRE_DY;
    const a = toScreen(this.iso, GATE.x + 1, y);
    const b = toScreen(this.iso, RING_MAX, y);
    this.dashed(a, b, 0x7dd3fc, 0.45, 7, 4, 2);
    const mid = toScreen(this.iso, GATE.x + 9, y - 0.6);
    this.netLabel = this.text(mid.x, mid.y, 'AWS global network', CSS.infoInk, this.texts).setAlpha(0.85);
    this.syncVisibility();
  }

  private dashed(a: Pt, b: Pt, color: number, alpha: number, dash: number, gap: number, w: number) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    this.g.lineStyle(w, color, alpha);
    for (let t = 0; t < len; t += dash + gap) {
      const e = Math.min(len, t + dash);
      this.g.lineBetween(Math.round(a.x + ux * t), Math.round(a.y + uy * t), Math.round(a.x + ux * e), Math.round(a.y + uy * e));
    }
  }

  /** The player's resources in each AZ (inventory items with an AZ, in this Region): one label per island. */
  private syncCounts() {
    const inv: Inventory | undefined = useCity.getState().inventory;
    const per = azCounts(this.islands, inv, this.region);
    const key = JSON.stringify([this.region, per, [...this.outageAzs], this.details, this.hoveredIsland]);
    if (key === this.counts && this.islandLabels.length) return;
    this.counts = key;
    for (const t of this.islandLabels) t.destroy();
    this.islandLabels = [];
    this.islandAnchors = [];
    this.islands.forEach((az, i) => {
      const n = per[i];
      const zone = `Zone ${zoneLetter(az, i)}`;
      const outage = this.outageAzs.has(az.id);
      let text: string;
      if (this.details || this.hoveredIsland === i) {
        // The AZ ID, and the account's own name for it when the account told us (names differ between accounts).
        const title = az.name ? `${zone} · ${az.name} · ${az.id}` : `${zone} · ${az.id}`;
        const line = !this.details || n === undefined ? '' : n === 0 ? '\nnone of your resources here' : `\n${n} of your resources here`;
        text = (outage ? '⛈️ ' : '') + title + line + (outage ? '\nAWS reports trouble in this zone' : '');
      } else text = outage ? `⛈️ ${zone} · AWS trouble` : zone;
      // Above the island's north (back) corner, clear of its data halls.
      const top = cornerScreen(this.iso, az.rect.x, az.rect.y);
      const t = this.text(top.x, top.y - 50, text, outage ? CSS.badInk : CSS.infoInk, this.islandLabels);
      this.islandAnchors.push({ x: t.x, y: t.y });
      t.setInteractive({ useHandCursor: true });
      t.on('pointerover', () => this.hoverIsland(i, true));
      t.on('pointerout', () => this.hoverIsland(i, false));
      this.tappable(t, i);
    });
  }

  // ── links ─────────────────────────────────────────────────────────────────

  private roads(): RoadGraph {
    const t = this.terrain?.() ?? this.graphOf ?? terrainFor(this.region, zonesFor(this.region, this.zones));
    if (!this.graph || this.graphOf !== t) {
      this.graph = new RoadGraph(t);
      this.graphOf = t;
    }
    return this.graph;
  }

  /** The road node an island's road ends at. */
  private islandNode(g: RoadGraph, az: AzIsland) {
    return g.node(az.bridge.end.x, az.bridge.end.y) ?? g.nearestNode(az.bridge.end);
  }

  /** One link at a time, in turn: a packet between AZ islands over their bridges, or out along the highway. */
  private playNext() {
    const link = this.links[this.next++ % this.links.length];
    if (!link) return;
    const color = COLORS[link.kind];
    const g = this.roads();
    const fa = link.from.az ? azIndex(this.islands, link.from.az) : undefined;
    const ta = link.to.az ? azIndex(this.islands, link.to.az) : undefined;
    const sameRegion = link.from.region === link.to.region;
    const carrier = CARRIER_FOR[link.kind];
    if (sameRegion && fa !== undefined && ta !== undefined && fa !== ta) {
      const a = this.islands[fa];
      const b = this.islands[ta];
      const path = g.routeTiles(this.islandNode(g, a), this.islandNode(g, b));
      if (path.length < 2) return;
      // Multi-AZ replication isn't billed as data transfer (RDS pricing); other cross-AZ traffic is, out and again in.
      const price1 = price('dt.interaz', this.region);
      const cost = link.kind === 'standby' ? 'Replication to the standby: no data transfer charge' : price1 ? `Cross-AZ data: ${perUnit(price1)} out, and again in` : undefined;
      const za = `Zone ${zoneLetter(a, fa)}`;
      const zb = `Zone ${zoneLetter(b, ta)}`;
      const there = this.dispatch?.(carrier, a.bridge.end, b.bridge.end, { kind: carrier, label: link.label, route: `${za} → ${zb}`, cost });
      const back = !!link.twoWay && !!this.dispatch?.(carrier, b.bridge.end, a.bridge.end, { kind: carrier, label: link.label, route: `${zb} → ${za}`, cost });
      if (!there && !back) this.convoy(path, color, !!link.twoWay);
      const mid = path[Math.floor(path.length / 2)];
      this.note({ x: mid.x, y: mid.y - 1.3 }, `${link.label} · ${link.from.az} → ${link.to.az}${cost ? `\n${cost}` : ''}`);
      return;
    }
    if (!sameRegion) {
      const other = link.from.region === this.region ? link.to.region : link.from.region;
      const here = link.from.region === this.region ? fa : ta;
      const start = here !== undefined ? this.islandNode(g, this.islands[here]) : g.nearestNode(DOWNTOWN);
      const path = [...g.routeTiles(start, g.gate), ...fibre()];
      if (path.length < 2) return;
      const out = price('dt.interregion', this.region);
      const usdOut = out?.byDestination?.[other] ?? out?.usd;
      const cost = out && usdOut !== undefined ? `\nData out to ${other}: ${perUnit({ ...out, usd: usdOut })}` : '';
      // The data drives out of the Region (and, two-way, back in) along the highway, beside the backbone's fibre.
      const local = here !== undefined ? this.islands[here].bridge.end : DOWNTOWN;
      const outbound = link.from.region === this.region;
      const cargo = (to: string): Cargo => ({ kind: carrier, label: link.label, route: to, cost: cost.trim() || undefined });
      const went = outbound || link.twoWay ? this.dispatch?.(carrier, local, 'highway', cargo(`→ ${other}`)) : false;
      const came = !outbound || link.twoWay ? this.dispatch?.(carrier, 'highway', local, cargo(`${other} →`)) : false;
      if (!went && !came) this.convoy(path, color, !!link.twoWay);
      // South of the highway: its destination signs stand on the north verge.
      this.note({ x: GATE.x + 4, y: GATE.y + 2.4 }, `${link.label} ${link.twoWay ? '⇄' : '→'} ${other}${cost}`);
    }
  }

  /** A link's data, big enough to follow: three packets in a row, slower than a message, and back again on a two-way link. */
  private convoy(path: Pt[], color: number, twoWay: boolean) {
    for (let k = 0; k < CONVOY; k++) {
      this.scene.time.delayedCall(k * CONVOY_GAP_MS, () => this.packets.sendRoute(path, color, { hop: LINK_HOP_MS, size: 1.5 }));
      if (twoWay) this.scene.time.delayedCall(1_200 + k * CONVOY_GAP_MS, () => this.packets.sendRoute([...path].reverse(), color, { hop: LINK_HOP_MS, size: 1.5 }));
    }
  }

  /** A passing note on a link (what it is, what it costs): a map detail, so only with that setting on. */
  private note(t: Pt, text: string) {
    for (const n of this.notes) n.destroy();
    this.notes = [];
    if (!this.details) return;
    const txt = this.label(t, text, CSS.inkHi, this.notes);
    txt.setBackgroundColor(withAlpha('panelHi', 0.92));
    this.clearOf(txt);
    this.scene.tweens.add({ targets: txt, alpha: 0, delay: 5_000, duration: 600, onComplete: () => txt.destroy() });
  }

  /** Slides a note down the screen, a few px at a time, until it covers no other label (a sign, an island, the Region). */
  private clearOf(txt: Phaser.GameObjects.Text) {
    const others = this.scene.children.list.filter((o) => o !== txt && isLabel(o)).map((o) => (o as Phaser.GameObjects.Text).getBounds());
    const gap = 3 * this.ui;
    for (let i = 0; i < 12; i++) {
      const b = txt.getBounds();
      const hit = others.find((o) => Phaser.Geom.Intersects.RectangleToRectangle(b, o));
      if (!hit) return;
      txt.setY(Math.round(txt.y + (hit.bottom - b.top) + gap));
    }
  }
}

/** Points along the fibre beside the highway, one a tile, from the gate out to the edge of the map. */
const fibre = (): Pt[] => {
  const out: Pt[] = [{ x: GATE.x + 0.5, y: GATE.y + FIBRE_DY }];
  for (let x = GATE.x + 1; x <= RING_MAX; x++) out.push({ x, y: GATE.y + FIBRE_DY });
  return out;
};
