import Phaser from 'phaser';
import type { Progress, ServerEvent } from '@/backend/contract';
import { bus } from '@/state/bus';
import { agentName, isDiscovered, openFindings, severityRank, taskRunning, tierOf, useCity, type Inventory } from '@/state/store';
import { dueFor } from '@/state/srs';
import { citizenLevel, levelName } from '@/state/citizens';
import { CITIZENS, citizenById } from '@/world/citizens';
import type { PageFocus } from '@/state/types';
import {
  DAY1_PLOT, DISTRICT_PLOTS, FUTURE_LABELS, FUTURE_PLOTS, GLOBAL_LANDMARKS, GRID, LANDMARKS, PLAYER_SPAWN, TOWN_SQUARE,
  homeRectFor, inRect, isRoad, landmarkLayout, type LandmarkLayout, type Rect, type Tile,
} from '@/world/layout';
import { ladder, newsOpen } from '@/state/ladder';
import { openedAreas } from '@/ui/useLadder';
import { questById, tipFor } from '@/world/content';
import { placeFor, TIER_NAMES } from '@/world/places';
import { DISTRICTS, districtById, SERVICES, servicesIn, serviceById, type DistrictId } from '@/world/taxonomy';
import { cityImpact, incidentsIn } from '@/world/incidents';
import { iconIds } from '@/world/icons';
import { Agent, type AgentWorld } from '../Agent';
import { hasSprite, iconKey, type Sfx } from '../assets';
import { blip, chime, click, sfx, type SfxOpts } from '../audio';
import { castFor, workAnimFor } from '../cast';
import { CityMap } from '../CityMap';
import { Citizens } from '../Citizens';
import { Workers, WORKER_CAP } from '../Workers';
import { postcardCaption, postcardName, savePostcard } from '../postcard';
import { DayNight } from '../DayNight';
import { CITY_ISO, cornerScreen, toScreen, toTile } from '../iso';
import { Landmark, type LandmarkSpec } from '../Landmark';
import { Packets } from '../Packets';
import { RegionOverlay } from '../RegionOverlay';
import { flowThrough, FLOWS, hasGoldenJacket, KAI_SHEET } from '@/world/culture';
import { accountZones, availability, regionInfo, signatureFor, statusText, zonesFor } from '@/world/regions';
import { Patrols } from '../Patrols';
import { RouteCache } from '../pathfinding';
import { CITIZEN_CAP, surfaceFor } from '@/world/traffic';
import { IssueMarkers } from '../IssueMarker';
import { keysBelongToUi } from '../keys';
import { reducedMotion } from '../motion';
import { crisp, TEXT_FONT } from '../SpeechBubble';
import { mayAutoPan } from '../calm';
import { frameTarget } from '../camera';
import { Landscape } from '../Landscape';
import { Park } from '../Park';
import { growthOf } from '@/state/growth';
import { Weather, type Storm } from '../Weather';
import { Ambient } from '../Ambient';
import { SEA_CSS, SEA_RGB } from '../palette';
import { takeDiveFrom } from '../worldmap';
import { keepTextInView, nonOverlapping, type Pt } from '../labels';
import { COLOR, CSS, FONT_SIZE, LABEL_BG, labelStyle, withAlpha } from '../theme';
import { Resources } from '../Resources';
import { TierProps } from '../TierProps';
import { LightsOut } from '../Drill';
import { onSceneEnd } from './lifecycle';

const LOOKOUT_HOME: Rect = { x: TOWN_SQUARE.rect.x + 8, y: TOWN_SQUARE.rect.y + 1, w: 4, h: 4 };
/** "? 2 more" signs (account resources with no landmark): above the props and landmarks, so a lamp or a tower never hides one. */
const UNKNOWN_SIGN_DEPTH = 40_050;
/** Lock and future-plot signs: above the cranes, lamps and trees standing on the plot (props are 10,000 + y). */
const PLOT_SIGN_DEPTH = 40_040;

/** The first sentence of a message, capped, for a speech bubble. */
export const firstLine = (text: string, max = 90) => {
  const first = text.split(/(?<=[.!?])\s|\s\(/)[0] ?? text;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
};

const KEYS = { W: [0, -1], UP: [0, -1], S: [0, 1], DOWN: [0, 1], A: [-1, 0], LEFT: [-1, 0], D: [1, 0], RIGHT: [1, 0] } as const;
type KeyName = keyof typeof KEYS | 'E' | 'OPEN_BRACKET' | 'CLOSED_BRACKET' | 'PLUS' | 'MINUS';
const ZOOMS = [1, 2, 3, 4];
/** Agents at least this far apart (tiles) send a courier for a call; nearer, the packet says it all. */
const COURIER_MIN_TILES = 8;

/** Height of the status ticker over the stage, plus a gap (app.css .ticker). */
const TICKER_PX = 34;
/** A tier-up within this long of an XP gain at the same landmark is the one reward shown (no "+N ⭐" float too). */
const REWARD_MERGE_MS = 500;
/** How often the scene re-reads the areas the player opened anyway (the ladder's `opened`, kept in localStorage). */
const LADDER_POLL_MS = 1_000;
/** How often the workers follow what's discovered (and the surface's cap). */
const WORKERS_EVERY_MS = 2_000;
/** The Day 1 Quarter's culture sites (offices, plaques, boards): a locked plot until the ladder opens day1. */
const isDay1Site = (l: LandmarkLayout) => !!l.site && inRect(l.footprint, DAY1_PLOT.rect);
/** Stars are the player-facing name for XP. */
const stars = (n: number) => `+${n} ⭐`;

export class CityScene extends Phaser.Scene {
  private map!: CityMap;
  private landmarks = new Map<string, Landmark>();
  private agents = new Map<string, Agent>();
  private player!: Agent;
  private citizens?: Citizens;
  /** Each discovered service's worker, on errands to the services it works with (Workers.ts). */
  private workers?: Workers;
  private workersAt = -Infinity;
  /** The six Well-Architected citizens, and the issue markers over landmarks with open findings. */
  private patrols?: Patrols;
  private markers?: IssueMarkers;
  /** "?" signs for account resources the city has no landmark for, by district (or 'square'). */
  private unknownSigns = new Map<string, Phaser.GameObjects.Text>();
  private packets!: Packets;
  /** The Region this city is: its boundary, AZ columns and bridges, and the data moving over them. */
  private region?: RegionOverlay;
  /** The river, countryside, coast and highway round the city (src/world/terrain.ts). */
  private landscape?: Landscape;
  /** re:Play Park on the terrain's park site: rides open as their buildings reach Practitioner (src/game/Park.ts). */
  private park?: Park;
  /** Traffic, boats, the sky and the baseline packets (src/game/Ambient.ts): ambience, never AWS activity. */
  private ambient?: Ambient;
  /** Landmark labels show at zoom 2+, or for the landmark hovered, selected, focused or with an issue (declutter). */
  private hoveredId?: string;
  private issueIds = new Set<string>();
  /** Agents the player has said hello to this visit (the next tap gets a tip). */
  private met = new Set<string>();
  /** The night level last pushed to the buildings; `nightDirty` forces the next push (new landmarks, new decor). */
  private lastNight = -1;
  private nightDirty = true;
  private tipTurn = 0;
  /** Who is showing a level-up bubble now: one at a time, the rest go to the feed only (the store logs them). */
  private cheering?: Agent;
  private dayNight!: DayNight;
  /** v2.6: storms from AWS's Health Dashboard (the only weather that means something). */
  private weather?: Weather;
  private plotSigns = new Map<string, Phaser.GameObjects.Text>();
  private focusRing!: Phaser.GameObjects.Graphics;
  private focusedId?: string;
  private offs: (() => void)[] = [];
  private tasks = new Map<string, { agentId: string; total: number }>();
  private dragging = false;
  /** scene time of the player's last pan, zoom, tap or handled key: the camera won't move on its own for a while after. */
  private lastInputAt = -Infinity;
  private following?: Agent;
  private lastUi = 0;
  /** "E · Talk to Sally" under the player when something is in reach. */
  private hint?: Phaser.GameObjects.Text;
  private hintAt = 0;
  private hintTarget?: { label: string; fn: () => void; landmark?: string };
  private keys: Partial<Record<KeyName, Phaser.Input.Keyboard.Key>> = {};
  private stepCount = 0;
  /** The landmark the "E · Visit X" hint names: its own sign steps aside while the hint shows. */
  private hintLandmark?: string;
  /** "Show the map details" (prefs.mapDetails): AZ IDs, link notes, distance signs, "? N more" signs. */
  private details = false;
  /** Whether the Day 1 Quarter has opened (the unlock ladder), and when it was last checked. */
  private day1Open = false;
  private ladderAt = 0;
  /** Where each plot / "? N more" sign belongs, before it's kept inside the view. */
  private signAnchors = new WeakMap<Phaser.GameObjects.Text, Pt>();
  /** Recent tier-ups by landmark (scene time), so an XP float in the same moment is dropped. */
  private tierUpAt = new Map<string, number>();
  private dueAt = 0;
  /** The "? N more" sign under the pointer (it stays up while read, though its district is no longer hovered). */
  private hoveredSign?: string;
  /** The player's own resources as props (houses on the AZ islands, boats on the lake…). */
  private resources?: Resources;
  /** Flags, benches and plazas as landmarks level up. */
  private tierProps?: TierProps;
  /** The "Lights out" practice drill on an AZ island (never AWS status). */
  private drill?: LightsOut;
  /** "🌐 Global Gate · the same in every city", over the global services' landmarks on the campus. */
  private gateSign?: Phaser.GameObjects.Text;
  private gateAnchor?: Pt;
  private gateHover = false;

  readonly world: AgentWorld = {
    iso: CITY_ISO,
    gridW: GRID,
    gridH: GRID,
    walkable: (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && !this.map.blocked.has(y * GRID + x),
    routes: new RouteCache(() => this.map?.blockedVersion ?? 0),
  };

  constructor() {
    super('city');
  }

  create() {
    this.cameras.main.setBackgroundColor(SEA_CSS).setRoundPixels(true);
    this.map = new CityMap(this);
    this.landscape = new Landscape(this);
    this.park = new Park(this);
    this.focusRing = this.add.graphics().setDepth(9_000);
    this.dayNight = new DayNight(this);
    this.weather = new Weather(this, surfaceFor(this.scale.width));
    this.packets = new Packets(this, CITY_ISO, GRID, (x, y) => this.map.isRoadTile(x, y) || this.map.isSidewalk(x, y));
    this.day1Open = this.computeDay1();
    this.details = useCity.getState().prefs?.mapDetails === true;
    this.syncWorld(useCity.getState().progress);

    this.spawnAgent('concierge', landmarkLayout('plaza')!.workSpot, TOWN_SQUARE.rect, landmarkLayout('plaza')!.workSpot);
    this.spawnAgent('lookout', landmarkLayout('lookout')!.workSpot, LOOKOUT_HOME, landmarkLayout('lookout')!.workSpot);
    this.spawnAgent('builder', landmarkLayout('workshop')!.workSpot, TOWN_SQUARE.rect, landmarkLayout('workshop')!.workSpot);
    this.player = new Agent(this, this.world, { id: 'player', sheet: KAI_SHEET, name: 'Kai (you)', tile: PLAYER_SPAWN, home: TOWN_SQUARE.rect, speed: 3, wanders: false, showTag: true });
    this.player.sprite.disableInteractive();
    this.player.onSpeak = (a) => this.sys.isActive() && blip(a.id);
    // Every other step makes a footfall, left and right in turn; the player's own walk, so never cut for focus.
    this.player.onStep = () => {
      this.stepCount++;
      if (this.stepCount % 2 === 0) this.play(this.stepCount % 4 === 0 ? 'step0' : 'step1', { own: true });
    };

    // Citizens stroll from sidewalk to sidewalk, 4–10 tiles at a time (picking from the whole grid rarely found one).
    // Sidewalk tiles change only when decor or buildings do: worked out once per grid version, not on every step.
    let walks: { version: number; tiles: Tile[] } | undefined;
    const sidewalks = () => {
      if (walks?.version !== this.map.blockedVersion) walks = { version: this.map.blockedVersion, tiles: this.map.sidewalkTiles().filter((t) => this.world.walkable(t.x, t.y)) };
      return walks.tiles;
    };
    this.citizens = new Citizens(
      this,
      {
        ...this.world,
        wanderable: (x, y) => this.map.isSidewalk(x, y),
        pickWander: (from) => {
          const near = sidewalks().filter((t) => {
            const d = Math.abs(t.x - from.x) + Math.abs(t.y - from.y);
            return d >= 4 && d <= 10;
          });
          return near[Math.floor(Math.random() * near.length)];
        },
      },
      sidewalks,
      {
        player: () => this.player,
        lakeShore: () => (tierOf(useCity.getState().progress, 's3', useCity.getState().cityRegion) >= 1 ? landmarkLayout('s3')!.workSpot : undefined),
        // What's going on, for what citizens talk about (src/world/dialogue.ts).
        context: () => {
          const s = useCity.getState();
          const here = incidentsIn(s.health, s.cityRegion).filter((i) => i.severity !== 'informational');
          const tiers = SERVICES.map((x) => Math.max(0, tierOf(s.progress, x.id, s.cityRegion)));
          const d = new Date();
          return {
            hour: this.dayNight.forcedHour ?? d.getHours() + d.getMinutes() / 60,
            outage: here.length ? (here.every((i) => i.drill) ? 'drill' : 'real') : undefined,
            openFindings: this.issueIds.size,
            level: tiers.reduce((a, b) => a + b, 0) / tiers.length,
          };
        },
      },
    );
    this.citizens.ensure(this.citizenTarget());
    this.workers = new Workers(this, { ...this.world, wanderable: (x, y) => this.map.isSidewalk(x, y) }, (id, w) => this.workerTalk(id, w));

    this.patrols = new Patrols(this, this.world, {
      unlocked: () => DISTRICTS.filter((d) => this.districtUnlocked(useCity.getState().progress, d.id)).map((d) => d.id),
      wanderable: (x, y) => this.map.isSidewalk(x, y),
      finding: (id) => useCity.getState().findings[id],
      onClick: (id) => this.onCitizenClick(id),
    });
    this.markers = new IssueMarkers(this, CITY_ISO, (serviceId) => this.openFindingAt(serviceId));
    // A remount (StrictMode, coming back from an interior) picks up the findings already open.
    const open = this.findingsHere(useCity.getState().findings);
    this.markers.sync(open);
    this.issueIds = new Set(open.map((f) => f.serviceId));
    for (const f of [...open].reverse()) this.patrols.raise(f);
    this.region = new RegionOverlay(this, CITY_ISO, this.packets, () => this.landscape?.terrain);
    this.tierProps = new TierProps(this);
    this.resources = new Resources(this, {
      terrain: () => this.landscape?.terrain,
      islands: () => this.region?.azIslands ?? [],
      letter: (i) => this.region?.letter(i) ?? String.fromCharCode(65 + i),
      tier: (id) => (this.landmarks.has(id) ? tierOf(useCity.getState().progress, id, useCity.getState().cityRegion) : -1),
      free: (x, y) => this.world.walkable(x, y) && !this.map.isSidewalk(x, y) && !isRoad({ x, y }) && !LANDMARKS.some((l) => l.workSpot.x === x && l.workSpot.y === y),
    });
    this.drill = new LightsOut(this, {
      landscape: () => this.landscape,
      region: () => this.region,
      placement: () => this.resources?.placement,
      storm: (i) => {
        const s = useCity.getState();
        return !!this.region?.isOutage(i) || !!cityImpact(incidentsIn(s.health, s.cityRegion), SERVICES.length).regionWide;
      },
      say: (r) => this.agents.get('concierge')?.say(r.line, { tone: r.ok ? 'done' : 'alert', caption: 'Lights-out drill', holdMs: 7_000 }),
      refuse: (text) => this.agents.get('concierge')?.say(text, { caption: 'Lights-out drill' }),
    });
    this.region.onIslandTap = (i) => this.drill?.offer(i);
    this.buildGateSign();
    this.tierProps.sync((id) => tierOf(useCity.getState().progress, id, useCity.getState().cityRegion));
    this.syncWorks(useCity.getState().progress);
    this.ambient = new Ambient(this, {
      packets: this.packets,
      terrain: () => this.landscape?.terrain,
      pedestrians: () => [...(this.citizens?.list ?? []), ...this.agents.values(), this.player].map((a) => ({ x: a.gx, y: a.gy })),
      busy: () => this.tasks.size > 0 || taskRunning(useCity.getState()),
      citizens: () => (this.citizens?.list.length ?? 0) + (this.workers?.list.length ?? 0),
      onSurface: (s) => {
        this.weather?.setSurface(s);
        this.citizens?.trim(this.citizenTarget());
        this.citizens?.ensure(this.citizenTarget());
      },
    });
    // The account's data links drive as data carriers on the same roads as the traffic.
    this.region.dispatch = (kind, from, to, cargo) => this.ambient?.dispatchData(kind, from, to, cargo) ?? false;
    this.enterRegion(useCity.getState().cityRegion);
    this.syncInventory(useCity.getState().inventory);
    this.syncDetails();

    this.setupCamera();
    // Coming back from the world map (or an interior): land in the chosen Region with a short zoom-in.
    this.events.on(Phaser.Scenes.Events.WAKE, () => this.arrive());
    if (useCity.getState().view.name === 'city') this.arrive();
    this.setupInput();
    this.subscribe();
    // SHUTDOWN on scene stop, DESTROY when the whole game is torn down (e.g. React StrictMode remount).
    onSceneEnd(this, () => this.teardown());

    const f = useCity.getState().focus;
    if (f) this.time.delayedCall(400, () => this.onFocus(f));
  }

  override update(time: number, dt: number) {
    const cam = this.cameras.main;
    // Text keeps one on-screen size at every zoom (it's rendered crisp, see SpeechBubble.crisp), times the
    // player's text size (⋯ → Text size).
    const ui = (useCity.getState().prefs.textSize ?? 100) / 100 / cam.zoom;
    const levels = useCity.getState().agentLevels;
    for (const [id, a] of this.agents) {
      a.speedBoost = 1 + 0.15 * ((levels[id] ?? 1) - 1);
      a.update(time, dt);
      a.setUiScale(ui);
    }
    this.handleKeys();
    this.player.update(time, dt);
    this.player.setUiScale(ui);
    this.updateHint(time, ui);
    this.citizens?.update(time, dt);
    this.workers?.update(time, dt);
    if (time - this.workersAt > WORKERS_EVERY_MS) {
      this.workersAt = time;
      this.syncWorkers();
      if (time - this.dueAt > 60_000) this.syncDue();
      // A pedestrian who was busy (talking, on an errand) when the crowd last made way is sent home now: the cap holds.
      const target = this.citizenTarget();
      if ((this.citizens?.list.length ?? 0) > target) this.citizens?.trim(target);
    }
    this.patrols?.update(time, dt);
    if (ui !== this.lastUi) {
      this.lastUi = ui;
      for (const l of this.landmarks.values()) l.setUiScale(ui);
      for (const t of this.plotSigns.values()) t.setScale(ui);
      for (const t of this.unknownSigns.values()) t.setScale(ui);
      this.citizens?.setUiScale(ui);
      this.workers?.setUiScale(ui);
      this.patrols?.setUiScale(ui);
      this.markers?.setUiScale(ui);
      this.region?.setUiScale(ui);
      this.landscape?.setUiScale(ui);
      this.resources?.setUiScale(ui);
      this.drill?.setUiScale(ui);
      this.gateSign?.setScale(ui);
      this.syncLabels();
    }
    // The AWS status ticker (src/ui/NewsTicker.tsx) covers the top ~34 px of the stage while it has something to say.
    const st = useCity.getState();
    const inset = st.health?.incidents.length || st.news?.items.length ? TICKER_PX : 0;
    this.keepLabelsInView(cam.worldView, ui, inset);
    if (time - this.ladderAt > LADDER_POLL_MS) {
      this.ladderAt = time;
      // "Peek at everything" (or the other surface) can open the Day 1 Quarter without a progress change.
      if (this.computeDay1() !== this.day1Open) this.syncWorld(st.progress);
    }
    this.landscape?.animate(time);
    this.park?.animate(time);
    this.dayNight.update();
    // Night changes over minutes (or when the hour is forced): only push it on when it moved, or when buildings were
    // rebuilt (a new Landmark starts dark-windowed).
    const n = this.dayNight.night;
    if (Math.abs(n - this.lastNight) > 0.002 || this.nightDirty) {
      this.lastNight = n;
      this.nightDirty = false;
      this.landscape?.setNight(n);
      this.park?.setNight(n);
      this.tierProps?.setNight(n);
      for (const l of this.landmarks.values()) l.setNight(n);
      this.map.setNight(n);
    }
    this.ambient?.setNight(n);
    this.ambient?.update(time, dt);
    this.weather?.update(dt);
  }

  // ── world building ───────────────────────────────────────────────────────

  private citizenTarget() {
    const p = useCity.getState().progress;
    // The pillar citizens (Patrols) count towards the crowd, so the city doesn't get busier.
    // At least 8 so a new city feels lived in; capped so the side panel stays light.
    const cap = CITIZEN_CAP[surfaceFor(this.scale.width)];
    // Each service's worker (Workers) takes the place of a pedestrian too.
    const workers = this.workers?.list.length ?? 0;
    return Math.max(2, Math.min(cap, Math.max(8, 10 + 3 * DISTRICTS.filter((d) => this.districtUnlocked(p, d.id)).length - CITIZENS.length)) - workers);
  }

  /**
   * One worker for each discovered service in this city (most-levelled first, up to the surface's cap), with errands to
   * the discovered services it works with in a real architecture (shared/flows.json). The crowd makes way for them.
   */
  private syncWorkers() {
    if (!this.workers) return;
    const s = useCity.getState();
    const here = (id: string) => isDiscovered(s.progress, id, s.cityRegion) && !!landmarkLayout(id) && this.landmarks.has(id);
    const ids = SERVICES.map((x) => x.id).filter(here);
    ids.sort((a, b) => tierOf(s.progress, b, s.cityRegion) - tierOf(s.progress, a, s.cityRegion));
    const posts = ids.map((id) => ({
      serviceId: id,
      name: `${serviceById(id)!.name.replace(/^(Amazon|AWS) /, '')} team`,
      workSpot: landmarkLayout(id)!.workSpot,
      partners: () => FLOWS.filter((f) => f.serviceIds.includes(id)).flatMap((f) => f.serviceIds).filter((o) => o !== id && here(o)).map((o) => landmarkLayout(o)!.workSpot),
    }));
    const before = this.workers.list.length;
    this.workers.sync(posts, WORKER_CAP[surfaceFor(this.scale.width)]);
    if (this.workers.list.length !== before) {
      this.citizens?.trim(this.citizenTarget());
      this.citizens?.ensure(this.citizenTarget());
    }
  }

  /** v2.8: live traffic (when the player turned it on and it was read): request cars from the real request counts. */
  private syncFlow() {
    const s = useCity.getState();
    const f = s.flowOn && s.flow && s.flow.unavailable === undefined ? s.flow : undefined;
    this.region?.setFlow(f?.rates ?? [], f?.region);
  }

  /** Tapping a service's worker: their building opens, and they share a tip from their service's deck. */
  private workerTalk(id: string, w: Agent) {
    const s = useCity.getState();
    this.select(id);
    w.face(this.player.tile);
    w.emote('wave', 1200);
    click();
    const tip = tipFor(id, Math.max(1, tierOf(s.progress, id, s.cityRegion)), this.tipTurn++);
    w.say(tip ? `💡 ${tip}` : `I work at ${placeFor(id)?.place ?? id}.`, { caption: w.name });
  }

  private districtUnlocked(p: Progress, d: DistrictId) {
    return servicesIn(d).some((s) => isDiscovered(p, s.id, useCity.getState().cityRegion));
  }

  private specFor(l: LandmarkLayout, p: Progress): LandmarkSpec {
    if (l.site) {
      // The Day 1 Quarter waits for the ladder (a locked plot sign stands there instead).
      if (isDay1Site(l) && !this.day1Open) return { id: l.id, sprite: l.site.sprite, footprint: l.footprint, label: l.site.label, tier: -1, showStars: false };
      // Campus / ops sites are always open; skip any the art hasn't drawn yet.
      if (!hasSprite(l.site.sprite)) return { id: l.id, sprite: l.site.sprite, footprint: l.footprint, label: l.site.label, tier: -1, showStars: false };
      return { id: l.id, sprite: l.site.sprite, footprint: l.footprint, label: l.site.label, tier: 1, showStars: false, noSign: !l.site.sign };
    }
    if (l.id === 'plaza') return { id: l.id, sprite: 'spheres', footprint: l.footprint, label: 'The Spheres · Console HQ', tier: 1, showStars: false };
    if (l.id === 'lookout') return { id: l.id, sprite: 'lookout', footprint: l.footprint, label: 'Lookout', tier: 1, showStars: false };
    if (l.id === 'workshop') return { id: l.id, sprite: 'workshop', footprint: l.footprint, label: 'CloudFormation Workshop', tier: 1, showStars: false };
    const d = districtById(l.districtId!)!;
    if (l.id.startsWith('hq:')) return { id: l.id, sprite: `hq:${d.id}`, footprint: l.footprint, label: d.hq, tier: this.districtUnlocked(p, d.id) ? 1 : -1, showStars: false };
    const place = placeFor(l.id)!;
    const tier = tierOf(p, l.id, useCity.getState().cityRegion);
    const icon = tier >= 0 && iconIds().includes(l.id) ? iconKey(l.id) : undefined;
    return { id: l.id, sprite: tier <= 0 ? 'construction3x3' : `lm:${l.id}:${tier}`, footprint: l.footprint, label: place.place, tier, showStars: true, icon };
  }

  /** Each building's sign counts its flashcards due again (also re-read once a minute: cards fall due with time). */
  private syncDue(p: Progress = useCity.getState().progress) {
    this.dueAt = this.time.now;
    for (const [id, lm] of this.landmarks) if (lm.spec.showStars) lm.setDue(dueFor(p, id));
  }

  /** Reconcile ground, landmarks, agents and signs with progress. */
  /** Scaffolding and cranes on buildings growing towards their next level (src/game/TierProps.ts). */
  private syncWorks(p: Progress) {
    const region = useCity.getState().cityRegion;
    this.tierProps?.syncWorks((id) => {
      if (!this.landmarks.has(id) || tierOf(p, id, region) < 0) return undefined;
      const g = growthOf(p, id, region);
      return { tier: g.tier, pct: g.pct, top: g.next === undefined };
    });
  }

  private syncPark() {
    const st = useCity.getState();
    this.park?.sync(this.landscape?.terrain?.park, st.progress, st.cityRegion);
  }

  private syncWorld(p: Progress) {
    this.syncPark();
    this.day1Open = this.computeDay1();
    this.map.sync(p, useCity.getState().cityRegion);
    let rebuilt = false;
    for (const l of LANDMARKS) {
      const spec = this.specFor(l, p);
      const cur = this.landmarks.get(l.id);
      if (cur && cur.spec.sprite === spec.sprite && cur.spec.tier === spec.tier) continue;
      cur?.destroy();
      this.landmarks.delete(l.id);
      if (spec.tier < 0) continue;
      const lm = new Landmark(this, CITY_ISO, spec);
      lm.onClick(() => this.onLandmarkClick(l.id));
      lm.img.on('pointerover', () => this.hover(l.id));
      lm.img.on('pointerout', () => this.hover(undefined, l.id));
      this.landmarks.set(l.id, lm);
      rebuilt = true;
    }
    // A rebuilt landmark gets this Region's badge and open/closed state back.
    if (rebuilt) this.syncInventory(useCity.getState().inventory);
    this.syncDue(p);
    // Agents whose landmark isn't in this Region's city move out (a new Region starts empty).
    for (const [id, a] of this.agents) {
      if (!serviceById(id) || isDiscovered(p, id, useCity.getState().cityRegion)) continue;
      a.destroy();
      this.agents.delete(id);
    }
    for (const d of DISTRICTS) {
      if (!this.districtUnlocked(p, d.id)) continue;
      for (const s of servicesIn(d.id)) {
        if (!isDiscovered(p, s.id, useCity.getState().cityRegion) || this.agents.has(s.id)) continue;
        const l = landmarkLayout(s.id)!;
        // A global service's agent roams the Global Gate, not its district.
        this.spawnAgent(s.id, l.workSpot, homeRectFor(s.id) ?? DISTRICT_PLOTS[d.id].rect, l.workSpot);
      }
    }
    this.syncPlotSigns(p);
    this.tierProps?.sync((id) => tierOf(p, id, useCity.getState().cityRegion));
    this.syncWorks(p);
    this.citizens?.ensure(this.citizenTarget());
    this.lastUi = 0;
    this.nightDirty = true;
  }

  /** The unlock ladder's Day 1 Quarter (src/state/ladder.ts): the first quest, or opened anyway. */
  private computeDay1() {
    const s = useCity.getState();
    let opened: ReadonlySet<string> = new Set();
    try {
      opened = openedAreas();
    } catch {
      /* no storage: nothing opened */
    }
    return ladder({ progress: s.progress, linked: !!s.account?.linked, hasDeploys: Object.keys(s.deploys ?? {}).length > 0, opened }).day1;
  }

  private syncPlotSigns(p: Progress) {
    // One short line; pointing at a locked sign shows how to open it, tapping it opens that Place card.
    const want = new Map<string, { rect: Rect; text: string; more?: string; first?: string }>();
    for (const d of DISTRICTS) {
      if (this.districtUnlocked(p, d.id)) continue;
      const svcs = servicesIn(d.id);
      const names = svcs.slice(0, 3).map((s) => s.name.replace(/^(Amazon|AWS) /, '')).join(' · ');
      want.set(d.id, { rect: DISTRICT_PLOTS[d.id].rect, text: `🔒 ${d.name}`, more: `🔒 ${d.name}\nOpen ${names}… in the console`, first: svcs[0]?.id });
    }
    FUTURE_PLOTS.forEach((f, i) => want.set(f.id, { rect: f.rect, text: `🚧 ${FUTURE_LABELS[i]}` }));
    if (!this.day1Open) want.set(DAY1_PLOT.id, { rect: DAY1_PLOT.rect, text: '🔒 Day 1 Quarter', more: '🔒 Day 1 Quarter\nFinish your first quest to open it' });
    for (const [id, sign] of this.plotSigns) if (!want.has(id)) sign.destroy(), this.plotSigns.delete(id);
    for (const [id, w] of want) {
      if (this.plotSigns.has(id)) continue;
      const c = toScreen(CITY_ISO, w.rect.x + (w.rect.w - 1) / 2, w.rect.y + (w.rect.h - 1) / 2);
      const sign = crisp(
        this.add
          .text(Math.round(c.x), Math.round(c.y), w.text, { ...labelStyle(TEXT_FONT, CSS.quote, FONT_SIZE.md), backgroundColor: withAlpha('bg', 0.9), padding: { x: 7, y: 4 } })
          .setOrigin(0.5)
          .setDepth(PLOT_SIGN_DEPTH)
          .setScale(1 / this.cameras.main.zoom),
      );
      this.signAnchors.set(sign, { x: sign.x, y: sign.y });
      if (w.more) {
        sign.setInteractive({ useHandCursor: true });
        sign.on('pointerover', () => sign.setText(w.more!).setDepth(PLOT_SIGN_DEPTH + 1));
        sign.on('pointerout', () => sign.setText(w.text).setDepth(PLOT_SIGN_DEPTH));
        sign.on('pointerdown', () => {
          if (!w.first) return;
          click();
          useCity.getState().select(w.first);
          bus.emit('select', { id: w.first });
        });
      }
      this.plotSigns.set(id, sign);
    }
  }

  private spawnAgent(id: string, tile: Tile, home: Rect, workSpot: Tile) {
    const c = castFor(id);
    if (!c) return;
    const a = new Agent(this, this.world, {
      id,
      name: c.name,
      tile,
      home,
      workSpot,
      workAnim: workAnimFor(c.activity),
      workDir: c.activity === 'fish' ? 'NE' : 'SE',
    });
    a.onClick(() => this.talkTo(id, a));
    a.onSpeak = (ag) => this.sys.isActive() && blip(ag.id);
    this.agents.set(id, a);
    return a;
  }

  private talkTo(id: string, a: Agent) {
    const lm = id === 'concierge' ? 'plaza' : id === 'lookout' ? 'lookout' : id === 'builder' ? 'workshop' : id;
    this.select(lm);
    a.face(this.player.tile);
    a.emote('hi', 1400);
    const place = placeFor(id);
    click();
    const s = useCity.getState();
    // An AWS outage that hits this agent's service here comes first: it's real and it's now.
    const hit = incidentsIn(s.health, s.cityRegion).find((i) => i.serviceIds.includes(id) && i.severity !== 'informational');
    if (hit) return void a.say(`${hit.drill ? 'Practice drill: my service is down here.' : 'AWS reports trouble with my service in this Region.'} Tap the news line over the city to see why.`, { tone: 'alert' });
    // First hello: who they are. After that, a tip from their deck, deeper as their landmark levels up.
    if (!this.met.has(id) || !place) {
      this.met.add(id);
      return void a.say(place ? `Hi! I'm ${a.name}. ${place.blurb}` : `Hi! I'm ${a.name}.`);
    }
    const tip = tipFor(id, Math.max(1, tierOf(s.progress, id, s.cityRegion)), this.tipTurn++);
    a.say(tip ? `💡 ${tip}` : `Hi again! ${place.blurb}`, { caption: tip ? 'Tip' : undefined });
  }

  // ── camera & input ───────────────────────────────────────────────────────

  /** The camera stays over the landscape: no void past the edge of the map. */
  private setCameraBounds() {
    const b = this.landscape?.terrain?.bounds;
    const w = GRID * CITY_ISO.halfW;
    if (b) this.cameras.main.setBounds(b.x, b.y, b.w, b.h);
    else this.cameras.main.setBounds(-w - 300, -400, 2 * w + 600, 2 * GRID * CITY_ISO.halfH + 700);
  }

  private setupCamera() {
    const cam = this.cameras.main;
    this.setCameraBounds();
    // The whole core at the best whole-number zoom, or the Town Square at zoom 1 (the side panel).
    const f = frameTarget(this.scale.width, this.scale.height);
    cam.setZoom(f.zoom);
    cam.centerOn(f.x, f.y);
  }

  /** The player is steering: automatic camera moves wait (src/game/calm.ts). */
  private noteInput() {
    this.lastInputAt = this.time.now;
  }

  /** Automatic moves (a discovery, a page focus, following a task) only while the player isn't moving the camera. */
  private mayAutoPan() {
    return mayAutoPan(this.time.now, this.lastInputAt);
  }

  private setupInput() {
    this.input.on('pointerdown', () => this.noteInput());
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      if (p.getDistance() > 8) this.dragging = true;
      if (!this.dragging) return;
      const cam = this.cameras.main;
      cam.stopFollow();
      this.following = undefined;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const wasDrag = this.dragging;
      this.dragging = false;
      if (wasDrag || over.length) return;
      const t = toTile(CITY_ISO, p.worldX, p.worldY);
      if (this.world.walkable(t.x, t.y)) this.player.goTo(t);
    });
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.noteInput();
      this.zoomStep(dy > 0 ? -1 : 1);
    });
    const kb = this.input.keyboard;
    if (kb) {
      for (const k of [...Object.keys(KEYS), 'E', 'OPEN_BRACKET', 'CLOSED_BRACKET', 'PLUS', 'MINUS'] as KeyName[]) this.keys[k] = kb.addKey(k, false);
      const on = (k: KeyName, fn: () => void) =>
        this.keys[k]?.on('down', () => {
          if (this.typing()) return;
          this.noteInput();
          fn();
        });
      on('E', () => this.interact());
      // Keyboard players: ] and [ step through the buildings, + and − zoom (the wheel's steps).
      on('CLOSED_BRACKET', () => this.stepBuilding(1));
      on('OPEN_BRACKET', () => this.stepBuilding(-1));
      on('PLUS', () => this.zoomStep(1));
      on('MINUS', () => this.zoomStep(-1));
    }
  }

  /** One zoom step in or out; whole-number zooms keep pixels crisp. */
  private zoomStep(by: 1 | -1) {
    const cam = this.cameras.main;
    const nearest = ZOOMS.reduce((a, b) => (Math.abs(b - cam.zoom) < Math.abs(a - cam.zoom) ? b : a));
    const to = ZOOMS[Phaser.Math.Clamp(ZOOMS.indexOf(nearest) + by, 0, ZOOMS.length - 1)];
    if (to !== nearest) cam.zoomTo(to, 150);
  }

  /** The next (or previous) building in reading order, back to front then left to right: show it, select it, say it. */
  private stepBuilding(by: 1 | -1) {
    const order = [...this.landmarks].sort(([, a], [, b]) => a.img.y - b.img.y || a.img.x - b.img.x).map(([id]) => id);
    if (!order.length) return;
    const at = order.indexOf(this.focusedId ?? useCity.getState().selected ?? '');
    const id = order[at < 0 ? (by > 0 ? 0 : order.length - 1) : (at + by + order.length) % order.length];
    this.flyTo(id);
    this.highlight(id);
    useCity.getState().select(id);
    const place = placeFor(id);
    bus.emit('announce', { text: `${place?.place ?? serviceById(id)?.name ?? id}. ${place?.simple ?? ''} ${order.indexOf(id) + 1} of ${order.length}.`.trim() });
  }

  /** Keys belong to the UI unless nothing (body) or the game itself has focus: tabs, menus and the tour use arrows too. */
  private typing() {
    return keysBelongToUi(document.activeElement, this.game.canvas);
  }

  private handleKeys() {
    if (this.typing()) return;
    for (const [k, [dx, dy]] of Object.entries(KEYS) as [keyof typeof KEYS, readonly [number, number]][]) {
      if (this.keys[k]?.isDown) {
        this.noteInput();
        if (this.player.step(dx, dy) && this.following !== this.player) this.follow(this.player);
        return;
      }
    }
  }

  /** What E would do now: the nearest agent to talk to, or the nearest landmark to visit. */
  private nearest(): { label: string; fn: () => void; landmark?: string } | undefined {
    const p = this.player;
    let best: { d: number; label: string; fn: () => void; landmark?: string } | undefined;
    for (const [id, a] of this.agents) {
      const d = Math.abs(a.gx - p.gx) + Math.abs(a.gy - p.gy);
      if (d <= 2 && (!best || d < best.d)) best = { d, label: `Talk to ${a.shortName}`, fn: () => this.talkTo(id, a) };
    }
    for (const l of LANDMARKS) {
      const d = Math.abs(l.workSpot.x - p.gx) + Math.abs(l.workSpot.y - p.gy);
      if (this.landmarks.has(l.id) && d <= 1 && (!best || d < best.d)) best = { d, label: `Visit ${placeFor(l.id)?.place ?? (l.id.startsWith('hq:') ? districtById(l.id.slice(3))?.hq : l.site?.label) ?? 'here'}`, fn: () => this.onLandmarkClick(l.id), landmark: l.id };
    }
    return best;
  }

  /** E: talk to the nearest agent, or enter/visit the nearest landmark. */
  private interact() {
    this.nearest()?.fn();
  }

  private updateHint(time: number, ui: number) {
    if (time - this.hintAt > 200) {
      this.hintAt = time;
      // A keyboard hint only where there's a keyboard-sized view (the full tab), not the narrow side panel.
      this.hintTarget = this.scale.width >= 560 ? this.nearest() : undefined;
      if (!this.hint) {
        this.hint = crisp(this.add.text(0, 0, '', { ...labelStyle(TEXT_FONT, CSS.accentInk), backgroundColor: CSS.accent }))
          .setOrigin(0.5, 0)
          .setDepth(59_000);
      }
      if (this.hintTarget) this.hint.setText(`E · ${this.hintTarget.label}`);
      // The hint names the landmark: its own sign steps aside rather than sit under the hint.
      const lm = this.hintTarget?.landmark;
      if (lm !== this.hintLandmark) {
        this.hintLandmark = lm;
        this.syncLabels();
      }
    }
    if (!this.hint) return;
    this.hint.setVisible(!!this.hintTarget);
    if (this.hintTarget) {
      const a = { x: Math.round(this.player.sprite.x), y: Math.round(this.player.sprite.y - 80 * ui) };
      this.hint.setPosition(a.x, a.y).setScale(ui).setOrigin(0.5, 1);
      keepTextInView(this.hint, a, this.cameras.main.worldView, ui);
    }
  }

  private flyTo(id: string) {
    if (id === 'signature') {
      // The Region's own landmark by the highway (terrain.ts): the city's postcard view.
      const sig = this.landscape?.terrain?.props.find((p) => p.role === 'signature');
      if (!sig) return;
      const c = toScreen(CITY_ISO, sig.x + 0.5, sig.y + 0.5);
      const cam = this.cameras.main;
      cam.stopFollow();
      this.following = undefined;
      if (reducedMotion()) cam.centerOn(c.x, c.y - 40);
      else cam.pan(c.x, c.y - 40, 700, 'Sine.easeInOut');
      return;
    }
    if (id === 'player') {
      // Kai, for the tour's "this is you": centre on Kai without following (the player may walk off).
      const cam = this.cameras.main;
      cam.stopFollow();
      this.following = undefined;
      const { x, y } = this.player.sprite;
      if (reducedMotion()) cam.centerOn(x, y - 30);
      else cam.pan(x, y - 30, 700, 'Sine.easeInOut');
      return;
    }
    const l = landmarkLayout(id);
    const rect = l?.footprint ?? DISTRICT_PLOTS[id as DistrictId]?.rect;
    if (!rect) return;
    const c = toScreen(CITY_ISO, rect.x + (rect.w - 1) / 2, rect.y + (rect.h - 1) / 2);
    const cam = this.cameras.main;
    cam.stopFollow();
    this.following = undefined;
    if (reducedMotion()) cam.centerOn(c.x, c.y - 30);
    else cam.pan(c.x, c.y - 30, 700, 'Sine.easeInOut');
  }

  private follow(a: Agent) {
    this.following = a;
    this.cameras.main.startFollow(a.sprite, true, 0.08, 0.08);
  }

  private highlight(id?: string) {
    this.focusedId = id;
    this.syncLabels();
    this.focusRing.clear();
    this.tweens.killTweensOf(this.focusRing);
    const l = id ? landmarkLayout(id) : undefined;
    if (!l) return;
    const f = l.footprint;
    const pts = [cornerScreen(CITY_ISO, f.x, f.y), cornerScreen(CITY_ISO, f.x + f.w, f.y), cornerScreen(CITY_ISO, f.x + f.w, f.y + f.h), cornerScreen(CITY_ISO, f.x, f.y + f.h)].map(
      (v) => new Phaser.Math.Vector2(v.x, v.y),
    );
    this.focusRing.lineStyle(2, COLOR.gold, 1).strokePoints(pts, true);
    this.focusRing.setAlpha(1);
    this.tweens.add({ targets: this.focusRing, alpha: 0.3, yoyo: true, repeat: -1, duration: 600 });
  }

  private select(id: string) {
    useCity.getState().select(id);
    bus.emit('select', { id });
  }

  private onLandmarkClick(id: string) {
    this.select(id);
    click();
    const l = landmarkLayout(id)!;
    if (id.startsWith('hq:') || id === 'plaza') {
      const districtId = id === 'plaza' ? 'spheres' : l.districtId!;
      this.player.goTo(l.workSpot, () => {
        this.play('door');
        this.player.emote('open_door', 900, 'NE');
        this.time.delayedCall(700, () => {
          bus.emit('enterHq', { districtId });
          useCity.getState().setView({ name: 'interior', districtId });
        });
      });
      return;
    }
    this.player.goTo(l.workSpot);
  }

  // ── reacting to the backend / browser ────────────────────────────────────

  private subscribe() {
    this.offs.push(
      useCity.subscribe((s, prev) => {
        if (s.flow !== prev.flow || s.flowOn !== prev.flowOn) this.syncFlow();
        if (s.progress !== prev.progress) {
          this.syncWorld(s.progress);
          this.syncJacket(s.progress, hasGoldenJacket(prev.progress));
        }
        if (s.selected !== prev.selected) {
          this.highlight(s.selected ?? this.focusedId);
          if (s.selected && serviceById(s.selected) && this.landmarks.has(s.selected)) this.tierProps?.sparkle(s.selected, tierOf(s.progress, s.selected, s.cityRegion));
        }
        if (s.findings !== prev.findings || s.cityRegion !== prev.cityRegion) {
          const here = this.findingsHere(s.findings);
          this.markers?.sync(here);
          this.issueIds = new Set(here.map((f) => f.serviceId));
          this.syncLabels();
        }
        if (s.inventory !== prev.inventory) this.syncInventory(s.inventory);
        if (s.prefs !== prev.prefs || s.account !== prev.account || s.deploys !== prev.deploys) {
          this.syncDetails();
          if (this.computeDay1() !== this.day1Open) this.syncWorld(s.progress);
        }
        if (s.health !== prev.health) this.syncHealth();
        if (s.cityRegion !== prev.cityRegion) {
          this.drill?.end();
          this.enterRegion(s.cityRegion);
          // Each Region is its own city: its own landmarks, agents and tiers.
          this.syncWorld(s.progress);
          this.syncInventory(s.inventory);
        }
      }),
      bus.on('findingRaised', ({ finding }) => this.patrols?.raise(finding)),
      bus.on('findingResolved', ({ finding, fixed }) => {
        this.patrols?.resolve(finding, fixed);
        this.landmarks.get(finding.serviceId)?.celebrate();
        this.burst(finding.serviceId);
        // Only the player's fix earns a sound; a finding that resolved by itself just quietly goes.
        if (fixed) this.play('correct');
      }),
      bus.on('citizenLevelUp', ({ citizenId, level }) => {
        const a = this.patrols?.agent(citizenId);
        if (!this.cheer(a, `I’m a ${levelName(level)} now. Thank you for teaching me!`, { tone: 'done', caption: 'Level up' })) return;
        a?.emote('jump', 1400);
        this.play('levelup');
      }),
      bus.on('showFinding', ({ findingId }) => {
        const f = useCity.getState().findings[findingId];
        if (!f) return;
        this.flyTo(f.serviceId);
        this.highlight(f.serviceId);
      }),
      bus.on('server', (e) => this.onServer(e)),
      bus.on('focus', (f) => this.onFocus(f)),
      bus.on('flyTo', ({ id }) => {
        this.flyTo(id);
        this.highlight(id);
      }),
      bus.on('postcard', () => {
        const st = useCity.getState();
        const r = regionInfo(st.cityRegion);
        const p = st.progress;
        const stars = [p.landmarks, ...Object.values(p.cities ?? {}).map((c) => c.landmarks)].reduce((n, ls) => n + Object.values(ls).reduce((m, l) => m + l.xp, 0), 0);
        const city = r?.city ?? st.cityRegion;
        this.game.renderer.snapshot((img) => {
          if (img instanceof HTMLImageElement) savePostcard(img, postcardCaption(city, st.cityRegion, stars, signatureFor(st.cityRegion)?.label), postcardName(city));
        });
        click();
      }),
      bus.on('locateKai', ({ reply }) => {
        // Kai's sprite bounds, camera → canvas → page (the canvas renders at CSS pixels).
        const cam = this.cameras.main;
        const b = this.player?.sprite.getBounds();
        const canvas = this.game.canvas.getBoundingClientRect();
        if (!b || !this.sys.isActive()) return reply(undefined);
        const left = canvas.left + (b.x - cam.worldView.x) * cam.zoom;
        const top = canvas.top + (b.y - cam.worldView.y) * cam.zoom;
        const r = { top, left, width: b.width * cam.zoom, height: b.height * cam.zoom };
        const inView = r.left + r.width > canvas.left && r.left < canvas.right && r.top + r.height > canvas.top && r.top < canvas.bottom;
        reply(inView ? r : undefined);
      }),
      bus.on('discovered', ({ serviceId, quiet }) => this.onDiscovered(serviceId, quiet)),
      bus.on('questDone', ({ questId }) => this.onQuestDone(questId)),
      // A tier-up is the canvas's one signal for it (no toast): the building bounces, confetti, a fanfare and a banner,
      // always; the agent's cheer only when no other bubble holds the floor.
      bus.on('tierUp', ({ serviceId, tier }) => {
        this.tierUpAt.set(serviceId, this.time.now);
        // Earned in a game, an HQ or on the world map (the city asleep): keep it for when the player comes back, so
        // the building's big moment is seen, not played to an empty room.
        if (!this.sys.isActive()) return void this.pendingTierUps.set(serviceId, Math.max(tier, this.pendingTierUps.get(serviceId) ?? 0));
        this.celebrateTier(serviceId, tier, true);
      }),
      bus.on('snap', ({ phase }) => this.onSnap(phase)),
      // The store sends xpGained just before a tier-up it caused: wait a beat, and let the tier-up be the one reward.
      bus.on('xpGained', ({ serviceId, amount }) => {
        const at = this.time.now;
        const merged = () => at - (this.tierUpAt.get(serviceId) ?? -Infinity) < REWARD_MERGE_MS || (this.tierUpAt.get(serviceId) ?? -Infinity) >= at;
        if (merged()) return;
        this.time.delayedCall(REWARD_MERGE_MS, () => !merged() && this.floatText(serviceId, stars(amount)));
      }),
      bus.on('hour', ({ hour }) => {
        this.dayNight.forcedHour = hour;
      }),
      bus.on('showFlow', ({ serviceIds }) => this.showFlow(serviceIds)),
      bus.on('incidentStarted', ({ incident }) => {
        if (incident.region !== useCity.getState().cityRegion || incident.severity === 'informational') return;
        // The first affected agent who's here says so; one soft falling chime for the moment.
        const a = incident.serviceIds.map((id) => this.agents.get(id)).find((x) => !!x);
        const what = incident.drill ? 'Practice drill: ' : 'AWS says ';
        this.cheer(a, `${what}${incident.severity === 'disruption' ? 'my service is down in this Region' : 'my service is having trouble here'}. Tap the news line to see why.`, { tone: 'alert', caption: 'AWS Health' });
        if (this.newsHeard()) this.ring(false);
      }),
      bus.on('incidentResolved', ({ incident }) => {
        if (incident.region !== useCity.getState().cityRegion || incident.severity === 'informational') return;
        const a = incident.serviceIds.map((id) => this.agents.get(id)).find((x) => !!x);
        if (this.cheer(a, incident.drill ? 'Drill over: we kept running.' : 'AWS says we’re back to normal.', { tone: 'done', caption: 'AWS Health' })) a?.emote('jump', 1000);
        if (this.newsHeard()) this.ring(true);
      }),
    );
  }

  private teardown() {
    for (const off of this.offs) off();
    this.offs = [];
    this.workers?.destroy();
    this.workers = undefined;
    this.region?.destroy();
    this.region = undefined;
    this.ambient?.destroy();
    this.ambient = undefined;
    this.weather?.destroy();
    this.weather = undefined;
    this.landscape?.destroy();
    this.landscape = undefined;
    this.park?.destroy();
    this.park = undefined;
    this.drill?.destroy();
    this.drill = undefined;
    this.resources?.destroy();
    this.resources = undefined;
    this.tierProps?.destroy();
    this.tierProps = undefined;
  }

  // ── declutter ────────────────────────────────────────────────────────────

  private hover(id: string | undefined, leaving?: string) {
    if (leaving && this.hoveredId !== leaving) return;
    this.hoveredId = id;
    // The Region sign on the campus: pointing at it shows the Region's line ("AWS Region · Oregon · us-west-2 · 4 AZs").
    this.region?.setRegionHover(id === 'regionsign');
    this.syncLabels();
  }

  /**
   * The Global Gate's sign: on the campus forecourt, in front of the global services' landmarks. It follows the label
   * budget (zoom 2+, or one of its landmarks hovered or selected); pointing at it says why they stand here.
   */
  private buildGateSign() {
    const lots = GLOBAL_LANDMARKS.filter((l) => l.footprint.y === GLOBAL_LANDMARKS[0]?.footprint.y);
    if (!lots.length) return;
    const xs = lots.map((l) => l.footprint.x + (l.footprint.w - 1) / 2);
    const front = lots[0].footprint.y + lots[0].footprint.h + 1.4;
    const c = toScreen(CITY_ISO, (Math.min(...xs) + Math.max(...xs)) / 2, front);
    const short = '🌐 Global Gate · the same in every city';
    const names = GLOBAL_LANDMARKS.map((l) => serviceById(l.id)?.name.replace(/^(Amazon|AWS) /, '')).filter(Boolean);
    const long = `${short}\n${names.join(', ')} aren’t tied to one Region:\nthey stand here in every city`;
    const sign = crisp(
      this.add
        .text(Math.round(c.x), Math.round(c.y), short, { ...labelStyle(TEXT_FONT, CSS.infoInk), backgroundColor: withAlpha('bg', 0.9) })
        .setOrigin(0.5)
        .setDepth(PLOT_SIGN_DEPTH - 1)
        .setScale(1 / this.cameras.main.zoom)
        .setVisible(false),
    );
    sign.setInteractive({ useHandCursor: true });
    sign.on('pointerover', () => {
      this.gateHover = true;
      sign.setText(long);
    });
    sign.on('pointerout', () => {
      this.gateHover = false;
      sign.setText(short);
      this.syncLabels();
    });
    this.gateSign = sign;
    this.gateAnchor = { x: sign.x, y: sign.y };
  }

  /** The "Show the map details" setting (prefs.mapDetails, in the ⋯ menu): technical labels on or off. */
  private syncDetails() {
    this.details = useCity.getState().prefs?.mapDetails === true;
    this.region?.setDetails(this.details);
    this.landscape?.setDetails(this.details);
    this.syncLabels();
  }

  /**
   * The label budget, in one place. Always: Kai's tag, the selected / focused building's name, every issue cone and
   * the most urgent one's "!" tag (the rest from zoom 2, or on the building the player is looking at).
   * From zoom 2 (or hovered): landmark names, and the Well-Architected citizens' first names (their pillar on hover).
   * With map details on: AZ IDs and counts, the network label, link notes, distance signs (RegionOverlay, Landscape)
   * and the "? N more" signs (else on hover of their district). Signs that would overlap give way, most important first,
   * and the "E · Visit X" hint stands in for its landmark's sign.
   */
  private syncLabels() {
    const zoom = this.cameras.main.zoom;
    const all = zoom >= 2;
    const selected = useCity.getState().selected;
    const must = (id: string) => id === selected || id === this.focusedId || id === this.hoveredId;
    const want = [...this.landmarks].filter(([id]) => id !== this.hintLandmark && (all || must(id)));
    for (const [id, lm] of this.landmarks) lm.showSign(want.some(([w]) => w === id));
    if (want.length > 1) {
      // Most important first: selected / focused / hovered, then the highest tier, then the nearest the front.
      const order = [...want].sort(([a, la], [b, lb]) => Number(must(b)) - Number(must(a)) || lb.spec.tier - la.spec.tier || lb.img.y - la.img.y);
      const keep = nonOverlapping(order, ([, lm]) => lm.signBounds(), 2 / zoom);
      for (const item of want) if (!keep.has(item)) item[1].showSign(false);
    }
    this.patrols?.setTagsShown(all);
    this.markers?.setTagsShown(all, must);
    this.resources?.setMoreShown(all || this.details);
    const gate = GLOBAL_LANDMARKS.some((l) => this.landmarks.has(l.id) && must(l.id));
    this.gateSign?.setVisible(all || gate || this.gateHover);
    // "? N more": only where the player is looking (their district hovered), or with map details on.
    const looking = this.hoveredId ? this.districtOf(this.hoveredId) : undefined;
    for (const [where, sign] of this.unknownSigns) sign.setVisible(this.details || where === looking || where === this.hoveredSign);
  }

  /** The plot a landmark stands in, as the "? N more" signs key it: a district id, or 'square' for the Town Square. */
  private districtOf(id: string): string | undefined {
    if (id === 'plaza' || id === 'lookout' || id === 'workshop') return 'square';
    const l = landmarkLayout(id);
    return l?.districtId ?? serviceById(id)?.districtId;
  }

  /** Per frame: every shown label slides in to stay whole inside the camera view (and clear of the status ticker). */
  private keepLabelsInView(view: Phaser.Geom.Rectangle, ui: number, inset: number) {
    this.region?.keepInView(view, inset);
    this.landscape?.keepInView(view, inset);
    for (const lm of this.landmarks.values()) lm.keepInView(view, inset);
    this.drill?.keepInView(view, inset);
    if (this.gateSign && this.gateAnchor) keepTextInView(this.gateSign, this.gateAnchor, view, ui, inset);
    for (const t of [...this.plotSigns.values(), ...this.unknownSigns.values()]) {
      const a = this.signAnchors.get(t);
      if (a) keepTextInView(t, a, view, ui, inset);
    }
  }

  /** A level-up bubble, unless another one is still up (that one goes to the feed only): never a flood of six. */
  private cheer(a: Agent | undefined, text: string, opts: Parameters<Agent['say']>[1]) {
    if (!a) return false;
    if (this.cheering && this.cheering !== a && this.cheering.speaking) return false;
    if (!a.say(text, opts)) return false;
    this.cheering = a;
    return true;
  }

  private agentTile(id: string): Tile | undefined {
    if (id === 'user') return this.player.tile;
    return (this.agents.get(id) ?? this.patrols?.agent(id))?.tile;
  }

  // ── city care: citizens, issue markers, the account's inventory ─────────

  /** Tapping a citizen: their newest open finding's card, else a hello and what they can do. */
  private onCitizenClick(citizenId: string) {
    click();
    const s = useCity.getState();
    const mine = openFindings(s.findings).filter((f) => f.citizenId === citizenId);
    const a = this.patrols?.agent(citizenId);
    const c = citizenById(citizenId);
    if (a && c) {
      a.face(this.player.tile);
      a.emote('wave', 1200);
      a.say(mine[0] ? c.greeting : `${c.greeting} I’m a ${levelName(citizenLevel(s.progress, c.id))}.`, { holdMs: 4000 });
    }
    if (mine[0]) s.openFinding(mine[0].id);
  }

  /** Tapping a marker: the worst (then newest) open finding at that landmark. */
  private openFindingAt(serviceId: string) {
    click();
    const here = openFindings(useCity.getState().findings).filter((f) => f.serviceId === serviceId);
    here.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    if (here[0]) useCity.getState().openFinding(here[0].id);
  }

  /** Count badges on landmarks, and a "?" sign per district for resources the city has no landmark for. */
  private syncInventory(inv?: Inventory) {
    const region = useCity.getState().cityRegion;
    const home = !inv?.homeRegion || inv.homeRegion === region;
    // The home Region's counts come from the server; another Region's city counts the items listed for it.
    const counts: Record<string, number> = home ? (inv?.counts ?? {}) : {};
    if (!home) for (const it of inv?.items ?? []) if (it.region === region) counts[it.serviceId ?? 'other'] = (counts[it.serviceId ?? 'other'] ?? 0) + 1;
    // A count beside each landmark the account has something in (none: no badge).
    for (const [id, lm] of this.landmarks) if (serviceById(id)) lm.setBadge(counts[id] ?? 0);
    this.region?.setRegion(region, accountZones(inv, region));
    this.region?.setLinks(inv?.links);
    this.syncFlow();
    this.syncOffered(region);
    this.resources?.sync(inv, region);
    const unknown = new Map<string, string[]>();
    for (const it of inv?.items ?? []) {
      if (it.serviceId || (it.region && it.region !== region && it.region !== 'global')) continue;
      const where = it.districtId && DISTRICT_PLOTS[it.districtId as DistrictId] ? it.districtId : 'square';
      unknown.set(where, [...(unknown.get(where) ?? []), it.type.replace(/^AWS::/, '').replace('::', ' ')]);
    }
    for (const [id, sign] of this.unknownSigns) if (!unknown.has(id)) sign.destroy(), this.unknownSigns.delete(id);
    for (const [id, types] of unknown) {
      const rect = id === 'square' ? TOWN_SQUARE.rect : DISTRICT_PLOTS[id as DistrictId].rect;
      const short = `? ${types.length} more`;
      const long = `Also in your account:\n${[...new Set(types)].slice(0, 5).join('\n')}${types.length > 5 ? '\n…' : ''}`;
      let sign = this.unknownSigns.get(id);
      if (!sign) {
        // The plot's west corner: clear of the landmarks and the lock sign in the middle.
        const c = toScreen(CITY_ISO, rect.x + 0.5, rect.y + rect.h - 1.5);
        sign = crisp(
          this.add
            .text(Math.round(c.x), Math.round(c.y), short, { ...labelStyle(TEXT_FONT, CSS.infoInk), backgroundColor: LABEL_BG, align: 'left' })
            .setOrigin(0.5)
            .setDepth(UNKNOWN_SIGN_DEPTH)
            .setScale(1 / this.cameras.main.zoom),
        );
        sign.setInteractive({ useHandCursor: true });
        this.signAnchors.set(sign, { x: sign.x, y: sign.y });
        this.unknownSigns.set(id, sign);
      }
      const sg = sign;
      sg.setText(short).removeAllListeners();
      sg.on('pointerover', () => {
        this.hoveredSign = id;
        sg.setText(long).setDepth(UNKNOWN_SIGN_DEPTH + 1);
      });
      sg.on('pointerout', () => {
        if (this.hoveredSign === id) this.hoveredSign = undefined;
        sg.setText(short).setDepth(UNKNOWN_SIGN_DEPTH);
        this.syncLabels();
      });
      sg.on('pointerup', () => sg.setText(sg.text === short ? long : short));
    }
    this.syncLabels();
  }

  private colorOf(id: string) {
    const s = serviceById(id);
    return s ? districtById(s.districtId)!.color : 0xff9900;
  }

  private onServer(e: ServerEvent) {
    switch (e.type) {
      case 'task.plan': {
        const a = this.agents.get(e.agentId);
        this.tasks.set(e.taskId, { agentId: e.agentId, total: e.steps.length });
        this.agents.get('concierge')?.say(`${agentName(e.agentId)}, you're up!`, { caption: 'Dispatching' });
        if (!a) return;
        a.pin(true);
        if (this.mayAutoPan()) this.follow(a);
        this.highlight(e.targetServiceId);
        const target = landmarkLayout(e.targetServiceId);
        if (target) a.goTo(target.workSpot);
        break;
      }
      case 'task.step': {
        const t = this.tasks.get(e.taskId);
        const a = t && this.agents.get(t.agentId);
        if (!a || e.status === 'pending') return;
        if (e.status === 'running') a.say(e.text, { caption: `Step ${e.index + 1}/${t.total}`, tone: 'step', holdMs: 6000 });
        if (e.status === 'skipped') a.say(`⤼ ${e.text}`, { tone: 'done', holdMs: 2500 });
        if (e.status === 'failed') a.say(`✗ ${e.text}`, { tone: 'alert' });
        break;
      }
      case 'agent.state': {
        const a = this.agents.get(e.agentId);
        if (!a) return this.patrols?.setWorking(e.agentId, e.state === 'working', e.detail);
        a.setDetail(e.state === 'working' ? e.detail : undefined);
        a.setWorking(e.state === 'working');
        // The work sound is for the player's own task, not every agent the backend keeps busy.
        if (e.state === 'working' && [...this.tasks.values()].some((t) => t.agentId === e.agentId)) this.play('work');
        break;
      }
      case 'agent.message': {
        const from = this.agents.get(e.from) ?? this.patrols?.agent(e.from);
        if (!from) return;
        const to = e.to === 'user' ? 'you' : agentName(e.to);
        // The bubble gets one short line; the panel keeps the full text and its caveats.
        // Agents talking among themselves with no task of yours running are ambient: a bubble only with chatter on.
        const ambient = e.to !== 'user' && !taskRunning(useCity.getState());
        // Only a line to the player blips: agents talking among themselves are seen, not heard.
        from.say(firstLine(e.text), { caption: `→ ${to}`, priority: ambient ? 'ambient' : 'normal', silent: e.to !== 'user' });
        const a = this.agentTile(e.from);
        const b = this.agentTile(e.to);
        // A bright packet is a real message (work); chatter gets none (the dim baseline packets are the ambience).
        if (a && b && !ambient) this.packets.send(a, b, this.colorOf(e.from));
        // A real call between two agents across town (during your task) also drives over as a courier: the packet is
        // the signal, the courier is the work being carried. Not for chatter, and not next door.
        if (a && b && e.to !== 'user' && !ambient && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= COURIER_MIN_TILES)
          this.ambient?.dispatchData('courier', a, b, { kind: 'courier', label: `${from.shortName} → ${agentName(e.to)}`, route: firstLine(e.text).slice(0, 80) });
        break;
      }
      case 'error': {
        // A task that fails mid-flight never sends task.done: release its agent so it doesn't stay frozen.
        const t = e.taskId ? this.tasks.get(e.taskId) : undefined;
        const a = t && this.agents.get(t.agentId);
        if (!t || !a) return;
        this.tasks.delete(e.taskId!);
        a.say('Something went wrong…', { tone: 'alert', caption: 'Task stopped' });
        a.setDetail(undefined);
        a.setWorking(false);
        a.pin(false);
        if (this.following === a) this.time.delayedCall(2500, () => this.following === a && (this.cameras.main.stopFollow(), (this.following = undefined)));
        break;
      }
      case 'task.done': {
        const t = this.tasks.get(e.taskId);
        const a = t && this.agents.get(t.agentId);
        this.tasks.delete(e.taskId);
        if (!a) return;
        const xp = e.xp.reduce((n, x) => n + x.amount, 0);
        a.say(e.ok ? `Done! ${stars(xp)}` : 'That didn’t work…', { tone: e.ok ? 'done' : 'alert', caption: 'Task complete' });
        a.pin(false);
        if (e.ok) {
          a.emote('jump', 1000);
          this.ring(true);
          this.burst(t.agentId);
          // Show how the request travels through the services this work belongs to (shared/flows.json).
          const flow = flowThrough(t.agentId);
          if (flow) this.time.delayedCall(1800, () => this.showFlow(flow.serviceIds.filter((id) => isDiscovered(useCity.getState().progress, id, useCity.getState().cityRegion)), false));
        }
        // Real work moves the camera: end on the agent who did it (not a helper), then let go. Not while the player steers.
        if (this.following !== a && this.mayAutoPan()) this.follow(a);
        this.time.delayedCall(2500, () => this.following === a && (this.cameras.main.stopFollow(), (this.following = undefined)));
        break;
      }
      case 'deploy.status':
        // A fix's deploy stays quiet: the finding's own "correct" and the citizen's level-up are the moment.
        if (e.status === 'complete' && !useCity.getState().deploys[e.deployId]?.findingId) {
          this.play('deploy');
          this.burst('workshop');
          this.agents.get('builder')?.emote('jump', 1200);
        }
        break;
      case 'console.step': {
        const a = this.agents.get(e.agentId);
        if (!a) return;
        if (!this.following && this.mayAutoPan()) this.follow(a);
        a.say(`${e.say}${e.why ? `\n💡 ${e.why}` : ''}`, { caption: e.action === 'done' ? 'Done in your console' : 'In your console', tone: e.action === 'done' ? 'done' : 'step', holdMs: 8000 });
        break;
      }
      case 'agent.level':
        if (this.cheer(this.agents.get(e.agentId), `Level ${e.level}! ${e.skill ?? ''}`, { tone: 'done' })) this.play('levelup');
        break;
    }
  }

  /**
   * The city's sounds play only while it's on screen: asleep under the world map, an HQ or a mini-game it stays
   * silent (its store and bus listeners keep running, so without this its fanfares played over the other scene).
   */
  private play(name: Sfx, opts?: SfxOpts) {
    if (this.sys.isActive()) sfx(name, opts);
  }

  private ring(up: boolean) {
    if (this.sys.isActive()) chime(up);
  }

  /** AWS status chimes follow the news rung (src/state/ladder.ts newsOpen), like its toast. */
  private newsHeard() {
    const s = useCity.getState();
    return newsOpen(s.progress, s.account.linked);
  }

  /** A finished quest: a fanfare, confetti over every landmark it taught, and the quest giver cheers. */
  private onQuestDone(questId: string) {
    const q = questById(questId);
    if (!q) return;
    this.play('quest');
    q.serviceIds.forEach((id, i) => this.time.delayedCall(i * 180, () => this.burst(id)));
    const giver = q.steps.find((st) => st.kind === 'visit')?.serviceId ?? q.serviceIds[0];
    const a = giver ? this.agents.get(giver) : undefined;
    a?.say(`Quest complete: ${q.title}! 🏆`, { tone: 'done', caption: 'Well done' });
    a?.emote('jump', 1400);
  }

  private onFocus(f: PageFocus) {
    const pan = this.mayAutoPan();
    if (f.kind === 'console-home') {
      if (pan) this.flyTo('plaza');
      this.highlight('plaza');
      this.agents.get('concierge')?.say('Welcome to the AWS Console! Open any service and I’ll build it in town.');
      return;
    }
    if (f.serviceId && this.landmarks.has(f.serviceId)) {
      if (pan) this.flyTo(f.serviceId);
      this.highlight(f.serviceId);
      const a = this.agents.get(f.serviceId);
      a?.emote('wave', 1600);
      a?.say(`You’re on my page! ${placeFor(f.serviceId)?.teaches[0] ?? ''}`);
      return;
    }
    this.highlight(undefined);
    // Auto-snap covers AWS pages only, so another site is shown to the city only when the player asks.
    if (f.kind === 'other') this.agents.get('lookout')?.say('New page! Press 📷 and I’ll show it to the city.', { holdMs: 3000 });
  }

  /** A new landmark. A quiet one (built because a finding or XP needed it) gets no camera move and no greeting. */
  private onDiscovered(serviceId: string, quiet = false) {
    // Quiet: its agent is already standing at work (the landmark sync spawned it there).
    if (quiet) return;
    if (this.mayAutoPan()) this.flyTo(serviceId);
    this.highlight(serviceId);
    this.play('discover');
    const a = this.agents.get(serviceId);
    if (!a) return;
    a.teleport(landmarkLayout('plaza')!.workSpot);
    a.pin(true);
    a.say(`Hi, I'm ${a.name}! Setting up ${placeFor(serviceId)?.place ?? 'here'}…`);
    a.goToWork(() => a.pin(false));
  }

  private onSnap(phase: 'start' | 'done' | 'failed') {
    const a = this.agents.get('lookout');
    if (phase === 'start') {
      a?.setWorking(true);
      a?.say('Say cheese! 📸', { caption: 'Snapping your page' });
      if (!reducedMotion()) this.cameras.main.flash(180, 255, 255, 255);
      if (a) this.follow(a);
    } else {
      a?.setWorking(false);
      if (phase === 'failed') a?.say('Couldn’t snap that page.', { tone: 'alert' });
      this.cameras.main.stopFollow();
      this.following = undefined;
    }
  }

  /** Animate an architecture: packets hop between the listed services in order. */
  private showFlow(ids: string[], fly = true) {
    const tiles = ids.map((id) => landmarkLayout(id)?.workSpot).filter((t): t is Tile => !!t);
    tiles.slice(1).forEach((t, i) => this.time.delayedCall(i * 900, () => this.packets.send(tiles[i], t, this.colorOf(ids[i]))));
    if (fly && ids[0] && this.mayAutoPan()) this.flyTo(ids[0]);
  }

  // ── Kai's golden jacket ──────────────────────────────────────────────

  /**
   * The real AWS Golden Jacket goes to people who hold every current AWS certification. Kai always wears the gold one
   * (KAI_SHEET); lighting every trophy in Golden Jacket Hall is a moment of its own, the first time.
   */
  private syncJacket(p: Progress, had: boolean) {
    if (!hasGoldenJacket(p) || had) return;
    this.player.emote('dance', 2000);
    this.play('levelup');
    useCity.getState().toast('🏆', 'Every certification trophy is lit! Kai’s golden jacket is fully earned.');
  }

  // ── the Region this city is ──────────────────────────────────────────────

  /** The citizens' checks run in the home Region, so their findings show in that city only. */
  private findingsHere(findings: Parameters<typeof openFindings>[0]) {
    const s = useCity.getState();
    const home = s.inventory?.homeRegion ?? s.account.region ?? s.cityRegion;
    return home === s.cityRegion ? openFindings(findings) : [];
  }

  private enterRegion(code: string) {
    const inv = useCity.getState().inventory;
    const linked = (inv?.links ?? []).flatMap((l) => [l.from.region, l.to.region]).filter((r): r is string => !!r && r !== code);
    this.landscape?.build(code, zonesFor(code, accountZones(inv, code)), [...new Set(linked)]);
    this.syncPark();
    this.nightDirty = true;
    // Same landscape (same Region and AZs): Ambient keeps its traffic; a new one rebuilds it.
    this.ambient?.build();
    this.setCameraBounds();
    this.region?.setRegion(code, accountZones(inv, code));
    this.region?.setLinks(inv?.links);
    this.syncFlow();
    this.syncOffered(code);
  }

  /** Each Region offers its own set of services: the others stand as fenced lots saying when (or whether) they're coming. */
  private syncOffered(code: string) {
    const city = regionInfo(code)?.city ?? code;
    for (const [id, lm] of this.landmarks) {
      if (!serviceById(id)) continue;
      const a = availability(id, code);
      lm.setClosed(a.status === 'available' ? null : a.status === 'outside-partition' ? `Not in ${city} · use a standard account` : `Not in ${city} · ${statusText(a)}`);
    }
    this.syncHealth();
  }

  /**
   * v2.6: AWS's Health Dashboard, in this Region's city. Each affected landmark is fenced and dark (red = disruption,
   * amber = degradation); a Region-wide event greys the whole city under rain, a smaller one puts a cloud over each
   * affected landmark and AZ island. It's AWS's status, not the player's account.
   */
  private syncHealth() {
    const s = useCity.getState();
    const here = incidentsIn(s.health, s.cityRegion);
    const impact = cityImpact(here, SERVICES.length);
    const drill = here.length > 0 && here.every((i) => i.drill);
    const spots: Storm['spots'] = [];
    for (const [id, lm] of this.landmarks) {
      if (!serviceById(id)) continue;
      const level = impact.services.get(id);
      const sev = level === 'disruption' || level === 'degradation' ? level : null;
      lm.setOutage(sev, drill ? `Drill · ${sev === 'disruption' ? 'outage' : 'trouble'}` : sev === 'disruption' ? 'AWS outage here' : 'AWS trouble here');
      if (sev && !impact.regionWide && !lm.isClosed) {
        const top = lm.img.getTopCenter();
        spots.push({ x: Math.round(top.x ?? 0), y: Math.round((top.y ?? 0) - 34), level: sev });
      }
    }
    this.region?.setOutageAzs(impact.azIds);
    // A real storm on the drill's island (or over the Region) ends the practice: AWS's status comes first.
    if (this.drill?.island !== undefined && (impact.regionWide || this.region?.isOutage(this.drill.island))) this.drill.end();
    for (const p of this.region?.outageSpots() ?? []) spots.push({ ...p, level: impact.regionWide ?? 'degradation' });
    this.weather?.set({ regionWide: impact.regionWide, spots });
  }

  /**
   * The end of the dive from the world map: the city fades in from the sea's blue, starting one zoom step out and
   * offset ~300 screen px toward the side the dive came from (takeDiveFrom), then pans and zooms to the usual framing
   * over 700 ms. Back from an interior there's no offset, just the zoom. Reduced motion jumps straight to the framing.
   */
  /** Tier-ups earned while the city was asleep, by service: celebrated after the player arrives back. */
  private pendingTierUps = new Map<string, number>();

  /** A building's tier-up: it bounces, confetti, a banner, a fanfare, its agent cheers; the camera goes to see it. */
  private celebrateTier(serviceId: string, tier: number, fly: boolean) {
    if (fly && this.mayAutoPan() && this.landmarks.has(serviceId)) this.flyTo(serviceId);
    this.landmarks.get(serviceId)?.celebrate();
    this.burst(serviceId);
    this.time.delayedCall(250, () => this.burst(serviceId));
    this.floatText(serviceId, `⭐ ${TIER_NAMES[tier]}!`, true);
    this.play('levelup');
    const a = this.agents.get(serviceId);
    if (this.cheer(a, `We just reached ${TIER_NAMES[tier]}! ⭐`, { tone: 'done' })) a?.emote('jump', 1200);
  }

  /** Back in the city: the tier-ups earned away from it, one at a time (the camera visits the first). */
  private replayTierUps() {
    const queued = [...this.pendingTierUps];
    this.pendingTierUps.clear();
    queued.forEach(([id, tier], i) => this.time.delayedCall(400 + i * 1400, () => this.celebrateTier(id, tier, i === 0)));
  }

  private arrive() {
    const cam = this.cameras.main;
    // Settled: the tour (and anything else waiting for the city) may start; then anything earned away is celebrated.
    const settled = () => {
      bus.emit('arrived', undefined);
      this.replayTierUps();
    };
    const from = takeDiveFrom(useCity.getState().cityRegion);
    const f = frameTarget(this.scale.width, this.scale.height);
    if (reducedMotion()) {
      cam.setZoom(f.zoom);
      cam.centerOn(f.x, f.y);
      return settled();
    }
    cam.fadeIn(300, ...SEA_RGB);
    const start = Math.max(1, f.zoom - 1);
    const ms = from ? 700 : 600;
    cam.setZoom(start);
    const off = from ? 300 / start : 0;
    cam.centerOn(f.x + Math.round((from?.x ?? 0) * off), f.y + Math.round((from?.y ?? 0) * off));
    if (from) cam.pan(f.x, f.y, ms, 'Sine.easeOut');
    if (start !== f.zoom) cam.zoomTo(f.zoom, ms, 'Sine.easeOut');
    this.time.delayedCall(from || start !== f.zoom ? ms : 300, settled);
  }

  // ── juice ────────────────────────────────────────────────────────────────

  private anchorFor(id: string) {
    const l = landmarkLayout(id);
    if (!l) return undefined;
    return toScreen(CITY_ISO, l.footprint.x + (l.footprint.w - 1) / 2, l.footprint.y + (l.footprint.h - 1) / 2);
  }

  /** A reward rising over a landmark ("+5 ⭐"); `big` for a tier-up banner, which stays up longer. */
  private floatText(id: string, text: string, big = false) {
    const c = this.anchorFor(id);
    if (!c) return;
    const ui = 1 / this.cameras.main.zoom;
    const t = crisp(
      this.add.text(Math.round(c.x), Math.round(c.y - 24 * ui), text, {
        fontFamily: TEXT_FONT,
        fontSize: big ? FONT_SIZE.lg : FONT_SIZE.md,
        fontStyle: '900',
        color: big ? CSS.gold : CSS.accent,
        stroke: CSS.bg,
        strokeThickness: 4,
      }),
    )
      .setOrigin(0.5)
      .setScale(ui)
      .setDepth(58_000);
    if (reducedMotion()) {
      this.time.delayedCall(big ? 2_200 : 1_400, () => t.destroy());
      return;
    }
    this.tweens.add({ targets: t, y: c.y - (big ? 90 : 60) * ui, alpha: 0, delay: big ? 700 : 0, duration: big ? 1_800 : 1_600, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  /** Confetti: ~40 chunky squares, the UI's festive tokens, fanning up and out and falling a little. */
  private burst(id: string) {
    const c = this.anchorFor(id);
    if (!c || reducedMotion()) return;
    const colors = [COLOR.gold, COLOR.accent, COLOR.good, COLOR.info, COLOR.bad, COLOR.goldHi];
    const N = 40;
    for (let i = 0; i < N; i++) {
      const size = 5 + (i % 3);
      const r = this.add.rectangle(c.x, c.y - 30, size, size, colors[i % colors.length]).setDepth(58_000);
      const ang = (i / N) * Math.PI * 2 + Math.random() * 0.2;
      const reach = 45 + Math.random() * 40;
      this.tweens.add({
        targets: r,
        x: c.x + Math.cos(ang) * reach,
        y: c.y - 30 + Math.sin(ang) * reach * 0.6 - 20,
        angle: Math.random() < 0.5 ? 180 : -180,
        alpha: 0,
        duration: 900 + Math.random() * 400,
        ease: 'Cubic.easeOut',
        onComplete: () => r.destroy(),
      });
    }
  }
}
