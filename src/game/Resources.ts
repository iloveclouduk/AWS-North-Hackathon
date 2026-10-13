// The player's own resources as small props (src/world/resources.ts decides where; this draws it): houses for servers
// and vaults for databases on their Availability Zone's island, a boat per bucket on S3 Lake, carts by the Lambda
// stall, "+N" where a group is capped, and one shed per district for kinds the city has no prop for. Pointing at (or
// tapping) a prop names it. Textures are baked from Graphics (src/game/propArt.ts); the props are plain Images, a few
// dozen at most, rebuilt only when the inventory, the Region or a landmark's tier changes.
import Phaser from 'phaser';
import type { InventoryItem } from '@/backend/contract';
import type { Inventory } from '@/state/store';
import { DISTRICT_PLOTS, GRID, isRoad, landmarkLayout, TOWN_SQUARE, type AzIsland, type Rect, type Tile } from '@/world/layout';
import { placeFor } from '@/world/places';
import { placeResources, propLine, type Group, type Placement } from '@/world/resources';
import type { Terrain } from '@/world/terrain';
import type { DistrictId } from '@/world/taxonomy';
import { CITY_ISO, entityDepth, footprintDepth, toScreen } from './iso';
import { ensurePropTexture, PROP_ORIGIN, type ArtKind } from './propArt';
import { crisp, TEXT_FONT } from './SpeechBubble';
import { CSS, labelStyle } from './theme';

/** Tooltips sit over every standing thing and sign (signs are 40,000+), under speech bubbles and the E hint. */
const TIP_DEPTH = 41_000;
const MORE_DEPTH = 40_030;
/** How far a pointer may move between down and up and still count as a tap, px. */
const TAP_SLOP = 8;

export interface ResourcesWorld {
  /** The landscape the scene built (its islands' free tiles). */
  terrain: () => Terrain | undefined;
  /** The islands drawn now, in zone order. */
  islands: () => readonly AzIsland[];
  /** "A", "B"…: an island's letter as its label shows it. */
  letter: (i: number) => string;
  /** A service landmark's tier here (-1 = not built: no props by an empty lot). */
  tier: (serviceId: string) => number;
  /** A tile a shed may stand on (not blocked, not a sidewalk, road or work spot). */
  free: (x: number, y: number) => boolean;
}

interface Prop {
  img: Phaser.GameObjects.Image;
  text: string;
}

export class Resources {
  private props: Prop[] = [];
  private more: Phaser.GameObjects.Text[] = [];
  private tip?: Phaser.GameObjects.Text;
  private tipFor?: Prop;
  private key = '';
  private ui = 1;
  private moreShown = false;
  /** Where things went, for the lights-out drill (src/world/drill.ts). */
  placement?: Placement;

  constructor(
    private scene: Phaser.Scene,
    private world: ResourcesWorld,
  ) {}

  /** Display objects this owns (the smoke budget). */
  get count() {
    return this.props.length + this.more.length + (this.tip ? 1 : 0);
  }

  sync(inv: Inventory | undefined, region: string) {
    const islands = this.world.islands();
    const placement = placeResources(inv?.items ?? [], [...islands], region, inv?.homeRegion);
    this.placement = placement;
    const tiers = Object.keys(placement.landmarks).map((id) => `${id}:${this.world.tier(id)}`);
    const key = JSON.stringify([region, islands.map((i) => i.id), placement, tiers, !!this.world.terrain()]);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    placement.zones.forEach((g, i) => this.drawIsland(g, i));
    for (const [id, g] of Object.entries(placement.landmarks)) this.drawLandmark(id, g);
    for (const [d, items] of Object.entries(placement.sheds)) this.drawShed(d, items);
    this.setUiScale(this.ui);
    this.setMoreShown(this.moreShown);
  }

  setUiScale(ui: number) {
    this.ui = ui;
    for (const t of this.more) t.setScale(ui);
    this.tip?.setScale(ui);
    if (this.tipFor) this.placeTip(this.tipFor);
  }

  /** The "+N" counts follow the label budget: zoom 2+, or map details on. */
  setMoreShown(on: boolean) {
    this.moreShown = on;
    for (const t of this.more) t.setVisible(on);
  }

  destroy() {
    this.clear();
    this.tip?.destroy();
    this.tip = undefined;
  }

  private clear() {
    for (const p of this.props) p.img.destroy();
    for (const t of this.more) t.destroy();
    this.props = [];
    this.more = [];
    this.hideTip();
  }

  // ── where ────────────────────────────────────────────────────────────────

  /** An island's free tiles (not under a data hall, a substation, a tower, the sign or the road), front first. */
  private islandTiles(i: number): Tile[] {
    const t = this.world.terrain();
    const isl = t?.islands[i];
    if (!t || !isl) return [];
    const r = isl.rect;
    const used = new Set<number>();
    const k = (x: number, y: number) => (y - r.y) * r.w + (x - r.x);
    for (const p of t.props)
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) used.add(k(x, y));
    for (const rd of isl.road) used.add(k(rd.x, rd.y));
    const out: Tile[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!used.has(k(x, y))) out.push({ x, y });
    return out.sort((a, b) => b.x + b.y - (a.x + a.y) || a.x - b.x);
  }

  private drawIsland(g: Group, i: number) {
    if (!g.shown.length) return;
    const tiles = this.islandTiles(i);
    const letter = this.world.letter(i);
    const zone = letter.charCodeAt(0) - 65;
    g.shown.forEach((p, n) => {
      const t = tiles[n];
      if (t) this.add(p.info.prop, toScreen(CITY_ISO, t.x, t.y), propLine(p, zone));
    });
    const t = tiles[g.shown.length];
    if (g.more && t) this.addMore(toScreen(CITY_ISO, t.x, t.y), g.more);
  }

  private drawLandmark(id: string, g: Group) {
    const l = landmarkLayout(id);
    const tier = this.world.tier(id);
    if (!l || tier < 0) return;
    const f = l.footprint;
    const lake = placeFor(id)?.kind === 'lake' && tier >= 1;
    const over = footprintDepth(CITY_ISO, f) + 1;
    g.shown.forEach((p, n) => {
      if (lake && p.info.prop === 'boat') {
        // Boats out on the lake's water (its last row is the beach).
        const at = toScreen(CITY_ISO, f.x + 0.7 + (n % 2) * 1.2, f.y + 0.6 + Math.floor(n / 2) * 0.9 + (n % 2) * 0.3);
        this.add('boat', at, propLine(p), over + n);
        return;
      }
      // Otherwise in a row along the landmark's south-east side, in front of its wall.
      this.add(p.info.prop, toScreen(CITY_ISO, f.x + f.w - 0.65, f.y + 0.45 + n * 0.7), propLine(p));
    });
    if (g.more) this.addMore(toScreen(CITY_ISO, f.x + f.w - 0.65, f.y + 0.45 + g.shown.length * 0.7), g.more);
  }

  private drawShed(where: string, items: InventoryItem[]) {
    const rect: Rect = DISTRICT_PLOTS[where as DistrictId]?.rect ?? TOWN_SQUARE.rect;
    // The plot's west corner first (low x, high y), clear of the lots in the middle.
    let spot: Tile | undefined;
    for (let d = 0; d < rect.w + rect.h && !spot; d++)
      for (let dx = 0; dx <= d && !spot; dx++) {
        const x = rect.x + dx;
        const y = rect.y + rect.h - 1 - (d - dx);
        if (x < rect.x + rect.w && y >= rect.y && x < GRID && !isRoad({ x, y }) && this.world.free(x, y)) spot = { x, y };
      }
    if (!spot) return;
    const kinds = [...new Set(items.map((it) => it.type.replace(/^AWS::/, '').replace('::', ' ')))];
    const what = `${items.length} more thing${items.length === 1 ? '' : 's'} of yours: ${kinds.slice(0, 3).join(', ')}${kinds.length > 3 ? '…' : ''}`;
    this.add('shed', toScreen(CITY_ISO, spot.x, spot.y), `Your shed: ${what}`);
  }

  // ── drawing ──────────────────────────────────────────────────────────────

  private add(kind: ArtKind, at: { x: number; y: number }, text: string, depth?: number) {
    const key = ensurePropTexture(this.scene, kind);
    const img = this.scene.add
      .image(Math.round(at.x), Math.round(at.y), key)
      .setOrigin(PROP_ORIGIN.x, PROP_ORIGIN.y)
      .setDepth(depth ?? entityDepth(at.y) + 0.2);
    img.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 1 });
    const prop = { img, text };
    img.on('pointerover', () => this.showTip(prop));
    img.on('pointerout', () => this.tipFor === prop && this.hideTip());
    img.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (Math.hypot(p.upX - p.downX, p.upY - p.downY) > TAP_SLOP) return;
      if (this.tipFor === prop) this.hideTip();
      else this.showTip(prop);
    });
    this.props.push(prop);
  }

  private addMore(at: { x: number; y: number }, n: number) {
    const t = crisp(
      this.scene.add
        .text(Math.round(at.x), Math.round(at.y - 6), `+${n}`, { ...labelStyle(TEXT_FONT, CSS.infoInk), padding: { x: 3, y: 1 } })
        .setOrigin(0.5)
        .setDepth(MORE_DEPTH)
        .setScale(this.ui)
        .setVisible(this.moreShown),
    );
    this.more.push(t);
  }

  private showTip(p: Prop) {
    if (!this.tip) {
      this.tip = crisp(this.scene.add.text(0, 0, '', labelStyle(TEXT_FONT, CSS.inkHi)).setOrigin(0.5, 1).setDepth(TIP_DEPTH));
    }
    this.tipFor = p;
    this.tip.setText(p.text).setScale(this.ui).setVisible(true);
    this.placeTip(p);
  }

  private placeTip(p: Prop) {
    const top = p.img.getTopCenter();
    this.tip?.setPosition(Math.round(top.x ?? p.img.x), Math.round((top.y ?? p.img.y) - 2 * this.ui));
  }

  private hideTip() {
    this.tipFor = undefined;
    this.tip?.setVisible(false);
  }
}
