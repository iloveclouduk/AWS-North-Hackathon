import Phaser from 'phaser';
import type { ServerEvent } from '@/backend/contract';
import { bus } from '@/state/bus';
import { agentName, isDiscovered, tierOf, useCity } from '@/state/store';
import type { PageFocus } from '@/state/types';
import {
  DISTRICT_PLOTS, FOUNTAIN, FUTURE_LABELS, FUTURE_PLOTS, GRID, LANDMARKS, PLAYER_SPAWN, TOWN_SQUARE,
  inRect, isRoad, landmarkLayout, plotAt, type LandmarkLayout, type Rect, type Tile,
} from '@/world/layout';
import { placeFor, TIER_NAMES } from '@/world/places';
import { DISTRICTS, districtById, servicesIn, serviceById, type DistrictId } from '@/world/taxonomy';
import type { Progress } from '@/backend/contract';
import { Agent, type AgentWorld } from '../Agent';
import { TILE_BASE_H, type CityTile } from '../assets';
import { castFor } from '../cast';
import { CITY_ISO, toScreen, toTile } from '../iso';
import { Landmark, type LandmarkSpec } from '../Landmark';
import { UI_FONT } from '../SpeechBubble';

const LOOKOUT_HOME: Rect = { x: TOWN_SQUARE.rect.x + 6, y: TOWN_SQUARE.rect.y + 2, w: 3, h: 3 };

export class CityScene extends Phaser.Scene {
  private ground: Phaser.GameObjects.Image[][] = [];
  private landmarks = new Map<string, Landmark>();
  private agents = new Map<string, Agent>();
  private player!: Agent;
  private plotSigns = new Map<string, Phaser.GameObjects.Text>();
  private focusRing!: Phaser.GameObjects.Graphics;
  private focusedId?: string;
  private blocked = new Set<number>();
  private offs: (() => void)[] = [];
  private tasks = new Map<string, { agentId: string; total: number }>();
  private dragging = false;
  private following?: Agent;
  private lastUi = 0;

  readonly world: AgentWorld = {
    iso: CITY_ISO,
    gridW: GRID,
    gridH: GRID,
    walkable: (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && !this.blocked.has(y * GRID + x),
  };

  constructor() {
    super('city');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0f1a2b');
    for (const l of LANDMARKS) this.block(l.footprint);
    this.blocked.add(FOUNTAIN.y * GRID + FOUNTAIN.x);

    this.buildGround();
    this.focusRing = this.add.graphics().setDepth(9_000);
    this.syncWorld(useCity.getState().progress);

    this.spawnAgent('concierge', landmarkLayout('plaza')!.workSpot, TOWN_SQUARE.rect, landmarkLayout('plaza')!.workSpot);
    this.spawnAgent('lookout', landmarkLayout('lookout')!.workSpot, LOOKOUT_HOME, landmarkLayout('lookout')!.workSpot);
    const p = castFor('player')!;
    this.player = new Agent(this, this.world, { id: 'player', name: 'You', look: p.look, tile: PLAYER_SPAWN, home: TOWN_SQUARE.rect, speed: 3.2, wanders: false });

    this.setupCamera();
    this.setupInput();
    this.subscribe();
    // SHUTDOWN on scene stop, DESTROY when the whole game is torn down (e.g. React StrictMode remount).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

    const f = useCity.getState().focus;
    if (f) this.time.delayedCall(400, () => this.onFocus(f));
  }

  override update(time: number, dt: number) {
    // In-world text keeps a roughly constant on-screen size regardless of zoom.
    const ui = Phaser.Math.Clamp(0.9 / this.cameras.main.zoom, 1, 2.4);
    for (const a of this.agents.values()) {
      a.update(time, dt);
      a.setUiScale(ui);
    }
    this.player.update(time, dt);
    if (ui !== this.lastUi) {
      this.lastUi = ui;
      for (const l of this.landmarks.values()) l.setUiScale(ui);
      for (const t of this.plotSigns.values()) t.setScale(ui);
    }
  }

  // ── world building ───────────────────────────────────────────────────────

  private block(r: Rect) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) this.blocked.add(y * GRID + x);
  }

  private districtUnlocked(p: Progress, d: DistrictId) {
    return servicesIn(d).some((s) => isDiscovered(p, s.id));
  }

  private groundKey(t: Tile, p: Progress): CityTile {
    if (isRoad(t)) return 'paving';
    const plot = plotAt(t);
    if (plot === 'square') {
      if (t.x === FOUNTAIN.x && t.y === FOUNTAIN.y) return 'fountain';
      const r = TOWN_SQUARE.rect;
      const corner = (t.x === r.x || t.x === r.x + r.w - 1) && (t.y === r.y || t.y === r.y + r.h - 1);
      return corner ? 'pavingTree' : 'paving';
    }
    if (plot?.startsWith('future')) return 'sand';
    const d = plot as DistrictId;
    if (!this.districtUnlocked(p, d)) return 'dirt';
    const lm = LANDMARKS.find((l) => l.districtId === d && inRect(t, l.footprint));
    if (lm && serviceById(lm.id)) {
      const tier = tierOf(p, lm.id);
      if (tier <= 0) return 'dirt';
      const kind = placeFor(lm.id)?.kind;
      if (kind === 'lake') return t.y === lm.footprint.y + lm.footprint.h - 1 ? 'sand' : 'water';
      if (kind === 'dock' && t.y === lm.footprint.y + lm.footprint.h - 1) return 'water';
      if (kind === 'garden') return 'grassDark';
      return 'grass';
    }
    return 'grass';
  }

  private buildGround() {
    const p = useCity.getState().progress;
    for (let y = 0; y < GRID; y++) {
      this.ground[y] = [];
      for (let x = 0; x < GRID; x++) {
        const img = this.add.image(0, 0, `k:${this.groundKey({ x, y }, p)}`).setOrigin(0.5, 0);
        this.placeTile(img, x, y);
        this.ground[y][x] = img;
      }
    }
  }

  private placeTile(img: Phaser.GameObjects.Image, x: number, y: number) {
    const s = toScreen(CITY_ISO, x, y);
    img.setPosition(s.x, s.y - CITY_ISO.halfH - Math.max(0, img.height - TILE_BASE_H)).setDepth(x + y);
  }

  private specFor(l: LandmarkLayout, p: Progress): LandmarkSpec {
    if (l.id === 'plaza') return { id: l.id, kind: 'plaza', footprint: l.footprint, color: 0xff9900, label: 'Console Plaza', tier: 1 };
    if (l.id === 'lookout') return { id: l.id, kind: 'lookout', footprint: l.footprint, color: 0x94a3b8, label: 'Lookout', tier: 1 };
    const d = districtById(l.districtId!)!;
    if (l.id.startsWith('hq:')) return { id: l.id, kind: 'hq', footprint: l.footprint, color: d.color, label: d.hq, tier: this.districtUnlocked(p, d.id) ? 1 : -1 };
    const place = placeFor(l.id)!;
    return { id: l.id, kind: place.kind, footprint: l.footprint, color: d.color, label: place.place, tier: tierOf(p, l.id) };
  }

  /** Reconcile ground, landmarks, agents and plot signs with progress. Cheap enough to run on every change. */
  private syncWorld(p: Progress) {
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        const key = `k:${this.groundKey({ x, y }, p)}`;
        const img = this.ground[y]?.[x];
        if (img && img.texture.key !== key) {
          img.setTexture(key);
          this.placeTile(img, x, y);
        }
      }

    for (const l of LANDMARKS) {
      const spec = this.specFor(l, p);
      const cur = this.landmarks.get(l.id);
      if (cur && cur.spec.tier === spec.tier) continue;
      cur?.destroy();
      this.landmarks.delete(l.id);
      if (spec.tier < 0) continue;
      const lm = new Landmark(this, CITY_ISO, spec);
      lm.onClick(() => this.onLandmarkClick(l.id));
      this.landmarks.set(l.id, lm);
    }

    for (const d of DISTRICTS) {
      if (!this.districtUnlocked(p, d.id)) continue;
      for (const s of servicesIn(d.id)) {
        if (!isDiscovered(p, s.id) || this.agents.has(s.id)) continue;
        const l = landmarkLayout(s.id)!;
        this.spawnAgent(s.id, l.workSpot, DISTRICT_PLOTS[d.id].rect, l.workSpot);
      }
    }

    this.syncPlotSigns(p);
    this.lastUi = 0; // re-apply UI scale to anything new
  }

  private syncPlotSigns(p: Progress) {
    const want = new Map<string, { rect: Rect; text: string }>();
    for (const d of DISTRICTS) {
      if (this.districtUnlocked(p, d.id)) continue;
      const names = servicesIn(d.id).map((s) => s.name.replace(/^(Amazon|AWS) /, '')).join(' · ');
      want.set(d.id, { rect: DISTRICT_PLOTS[d.id].rect, text: `🔒 ${d.name}\nOpen ${names} in the AWS console` });
    }
    FUTURE_PLOTS.forEach((f, i) => want.set(f.id, { rect: f.rect, text: `🏗️ ${FUTURE_LABELS[i]}` }));

    for (const [id, sign] of this.plotSigns) if (!want.has(id)) sign.destroy(), this.plotSigns.delete(id);
    for (const [id, w] of want) {
      if (this.plotSigns.has(id)) continue;
      const c = toScreen(CITY_ISO, w.rect.x + (w.rect.w - 1) / 2, w.rect.y + (w.rect.h - 1) / 2);
      const t = this.add
        .text(c.x, c.y, w.text, { fontFamily: UI_FONT, fontSize: '14px', fontStyle: 'bold', align: 'center', color: '#fef3c7', backgroundColor: '#161622bb', padding: { x: 8, y: 5 }, resolution: 2 })
        .setOrigin(0.5)
        .setDepth(9_500);
      this.plotSigns.set(id, t);
    }
  }

  private spawnAgent(id: string, tile: Tile, home: Rect, workSpot: Tile) {
    const c = castFor(id);
    if (!c) return;
    const a = new Agent(this, this.world, { id, name: c.name, look: c.look, tile, home, workSpot });
    a.onClick(() => {
      this.select(id === 'concierge' ? 'plaza' : id);
      const place = placeFor(id);
      a.say(place ? `Hi! I'm ${c.name}. ${place.blurb}` : `Hi! I'm ${c.name}.`);
    });
    this.agents.set(id, a);
    return a;
  }

  // ── camera & input ───────────────────────────────────────────────────────

  private setupCamera() {
    const cam = this.cameras.main;
    const w = GRID * CITY_ISO.halfW;
    cam.setBounds(-w - 200, -300, 2 * w + 400, 2 * GRID * CITY_ISO.halfH + 500);
    const fit = () => cam.setZoom(Phaser.Math.Clamp(this.scale.width / 1700, 0.5, 0.85));
    fit();
    this.scale.on('resize', fit);
    this.offs.push(() => this.scale.off('resize', fit));
    const c = toScreen(CITY_ISO, TOWN_SQUARE.rect.x + 4, TOWN_SQUARE.rect.y + 4);
    cam.centerOn(c.x, c.y);
  }

  private setupInput() {
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
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.3, 1.6));
    });
  }

  private flyTo(id: string, zoom?: number) {
    const l = landmarkLayout(id);
    const rect = l?.footprint ?? DISTRICT_PLOTS[id as DistrictId]?.rect;
    if (!rect) return;
    const c = toScreen(CITY_ISO, rect.x + (rect.w - 1) / 2, rect.y + (rect.h - 1) / 2);
    const cam = this.cameras.main;
    cam.stopFollow();
    this.following = undefined;
    cam.pan(c.x, c.y - 30, 700, 'Sine.easeInOut');
    if (zoom) cam.zoomTo(zoom, 700);
  }

  private follow(a: Agent) {
    this.following = a;
    this.cameras.main.startFollow(a.sprite, true, 0.06, 0.06);
  }

  private highlight(id?: string) {
    this.focusedId = id;
    this.focusRing.clear();
    this.tweens.killTweensOf(this.focusRing);
    const l = id ? landmarkLayout(id) : undefined;
    if (!l) return;
    const f = l.footprint;
    const P = (gx: number, gy: number) => toScreen(CITY_ISO, gx, gy);
    const pts = [P(f.x - 0.6, f.y - 0.6), P(f.x + f.w - 0.4, f.y - 0.6), P(f.x + f.w - 0.4, f.y + f.h - 0.4), P(f.x - 0.6, f.y + f.h - 0.4)].map(
      (v) => new Phaser.Math.Vector2(v.x, v.y),
    );
    this.focusRing.lineStyle(4, 0xfde047, 1).strokePoints(pts, true);
    this.focusRing.setAlpha(1);
    this.tweens.add({ targets: this.focusRing, alpha: 0.35, yoyo: true, repeat: -1, duration: 700 });
  }

  private select(id: string) {
    useCity.getState().select(id);
    bus.emit('select', { id });
  }

  private onLandmarkClick(id: string) {
    this.select(id);
    const l = landmarkLayout(id)!;
    if (id.startsWith('hq:')) {
      const districtId = l.districtId!;
      this.player.goTo(l.workSpot, () => {
        bus.emit('enterHq', { districtId });
        useCity.getState().setView({ name: 'interior', districtId });
      });
      return;
    }
    this.player.goTo(l.workSpot);
  }

  // ── reacting to the backend / browser ────────────────────────────────────

  private subscribe() {
    this.offs.push(
      useCity.subscribe((s, prev) => {
        if (s.progress !== prev.progress) this.syncWorld(s.progress);
        if (s.selected !== prev.selected) this.highlight(s.selected ?? this.focusedId);
      }),
      bus.on('server', (e) => this.onServer(e)),
      bus.on('focus', (f) => this.onFocus(f)),
      bus.on('flyTo', ({ id }) => {
        this.flyTo(id);
        this.highlight(id);
      }),
      bus.on('discovered', ({ serviceId }) => this.onDiscovered(serviceId)),
      bus.on('tierUp', ({ serviceId, tier }) => {
        this.landmarks.get(serviceId)?.celebrate();
        this.agents.get(serviceId)?.say(`We just reached ${TIER_NAMES[tier]}! ⭐`, { tone: 'done' });
        this.burst(serviceId);
      }),
      bus.on('snap', ({ phase }) => this.onSnap(phase)),
      bus.on('xpGained', ({ serviceId, amount }) => this.floatText(serviceId, `+${amount} XP`)),
    );
  }

  private teardown() {
    for (const off of this.offs) off();
    this.offs = [];
  }

  private onServer(e: ServerEvent) {
    switch (e.type) {
      case 'task.plan': {
        const a = this.agents.get(e.agentId);
        this.tasks.set(e.taskId, { agentId: e.agentId, total: e.steps.length });
        this.agents.get('concierge')?.say(`${agentName(e.agentId)}, you're up!`, { caption: 'Dispatching' });
        if (!a) return;
        a.pin(true);
        this.follow(a);
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
        if (e.status === 'failed') a.say(`✗ ${e.text}`, { tone: 'alert' });
        break;
      }
      case 'agent.state': {
        const a = this.agents.get(e.agentId);
        if (!a) return;
        a.setDetail(e.state === 'working' ? e.detail : undefined);
        a.setWorking(e.state === 'working');
        break;
      }
      case 'agent.message': {
        const from = this.agents.get(e.from);
        if (!from) return;
        const to = e.to === 'user' ? 'you' : agentName(e.to);
        from.say(e.text, { caption: `→ ${to}` });
        const target = e.to === 'user' ? this.player : this.agents.get(e.to);
        if (target) this.sendPacket(from, target);
        break;
      }
      case 'task.done': {
        const t = this.tasks.get(e.taskId);
        const a = t && this.agents.get(t.agentId);
        this.tasks.delete(e.taskId);
        if (!a) return;
        const xp = e.xp.reduce((n, x) => n + x.amount, 0);
        a.say(e.ok ? `Done! +${xp} XP` : 'That didn’t work…', { tone: e.ok ? 'done' : 'alert', caption: 'Task complete' });
        a.pin(false);
        if (this.following === a) this.time.delayedCall(2500, () => this.following === a && (this.cameras.main.stopFollow(), (this.following = undefined)));
        if (e.ok) this.burst(t.agentId);
        break;
      }
    }
  }

  private onFocus(f: PageFocus) {
    if (f.kind === 'console-home') {
      this.flyTo('plaza');
      this.highlight('plaza');
      this.agents.get('concierge')?.say('Welcome to the AWS Console! Open any service and I’ll build it in town.');
      return;
    }
    if (f.serviceId && this.landmarks.has(f.serviceId)) {
      this.flyTo(f.serviceId);
      this.highlight(f.serviceId);
      const a = this.agents.get(f.serviceId);
      a?.wave();
      a?.say(`You’re on my page! ${placeFor(f.serviceId)?.teaches[0] ?? ''}`);
      return;
    }
    this.highlight(undefined);
    if (f.kind === 'other' && !useCity.getState().autoSnap) this.agents.get('lookout')?.say('New page! Press 📷 and I’ll show it to the city.', { holdMs: 3000 });
  }

  private onDiscovered(serviceId: string) {
    this.flyTo(serviceId);
    this.highlight(serviceId);
    const a = this.agents.get(serviceId);
    if (!a) return;
    // New arrivals walk in from Console Plaza.
    a.teleport(landmarkLayout('plaza')!.workSpot);
    a.pin(true);
    a.say(`Hi, I'm ${a.name}! Setting up ${placeFor(serviceId)?.place}…`);
    a.goToWork(() => a.pin(false));
  }

  private onSnap(phase: 'start' | 'done' | 'failed') {
    const a = this.agents.get('lookout');
    if (phase === 'start') {
      a?.setWorking(true);
      a?.say('Say cheese! 📸', { caption: 'Snapping your page' });
      this.cameras.main.flash(180, 255, 255, 255);
      if (a) this.follow(a);
    } else {
      a?.setWorking(false);
      if (phase === 'failed') a?.say('Couldn’t snap that page.', { tone: 'alert' });
      this.cameras.main.stopFollow();
      this.following = undefined;
    }
  }

  // ── little juice ─────────────────────────────────────────────────────────

  /** An envelope flies from one agent to another when they talk. */
  private sendPacket(from: Agent, to: Agent) {
    const a = from.screen;
    const b = to.screen;
    const env = this.add.text(a.x, a.y - 60, '✉️', { fontSize: '18px' }).setOrigin(0.5).setDepth(55_000);
    const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    this.tweens.add({ targets: env, x: b.x, y: b.y - 60, duration: Phaser.Math.Clamp(dist * 1.2, 400, 1800), ease: 'Sine.easeInOut', onComplete: () => env.destroy() });
  }

  private anchorFor(id: string) {
    const l = landmarkLayout(id);
    if (!l) return undefined;
    return toScreen(CITY_ISO, l.footprint.x + (l.footprint.w - 1) / 2, l.footprint.y + (l.footprint.h - 1) / 2);
  }

  private floatText(id: string, text: string) {
    const c = this.anchorFor(id);
    if (!c) return;
    const t = this.add.text(c.x, c.y - 40, text, { fontFamily: UI_FONT, fontSize: '16px', fontStyle: 'bold', color: '#fde047', stroke: '#161622', strokeThickness: 4, resolution: 2 }).setOrigin(0.5).setDepth(58_000);
    this.tweens.add({ targets: t, y: c.y - 110, alpha: 0, duration: 1600, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private burst(id: string) {
    const c = this.anchorFor(id);
    if (!c) return;
    const colors = [0xfde047, 0xf472b6, 0x60a5fa, 0x34d399, 0xff9900];
    for (let i = 0; i < 18; i++) {
      const r = this.add.rectangle(c.x, c.y - 40, 6, 6, colors[i % colors.length]).setDepth(58_000);
      const ang = (i / 18) * Math.PI * 2;
      this.tweens.add({ targets: r, x: c.x + Math.cos(ang) * 90, y: c.y - 40 + Math.sin(ang) * 60 - 40, alpha: 0, angle: 180, duration: 900, ease: 'Cubic.easeOut', onComplete: () => r.destroy() });
    }
  }
}
