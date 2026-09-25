import Phaser from 'phaser';
import type { Progress, ServerEvent } from '@/backend/contract';
import { bus } from '@/state/bus';
import { agentName, isDiscovered, tierOf, useCity } from '@/state/store';
import type { PageFocus } from '@/state/types';
import {
  DISTRICT_PLOTS, FUTURE_LABELS, FUTURE_PLOTS, GRID, LANDMARKS, PLAYER_SPAWN, TOWN_SQUARE,
  landmarkLayout, type LandmarkLayout, type Rect, type Tile,
} from '@/world/layout';
import { placeFor, TIER_NAMES } from '@/world/places';
import { DISTRICTS, districtById, servicesIn, serviceById, type DistrictId } from '@/world/taxonomy';
import { Agent, type AgentWorld } from '../Agent';
import { blip, chime, click, sfx } from '../audio';
import { castFor, workAnimFor } from '../cast';
import { CityMap } from '../CityMap';
import { Citizens } from '../Citizens';
import { DayNight } from '../DayNight';
import { CITY_ISO, cornerScreen, toScreen, toTile } from '../iso';
import { Landmark, type LandmarkSpec } from '../Landmark';
import { Packets } from '../Packets';
import { crisp, TEXT_FONT } from '../SpeechBubble';

const LOOKOUT_HOME: Rect = { x: TOWN_SQUARE.rect.x + 8, y: TOWN_SQUARE.rect.y + 1, w: 4, h: 4 };
const KEYS = { W: [0, -1], UP: [0, -1], S: [0, 1], DOWN: [0, 1], A: [-1, 0], LEFT: [-1, 0], D: [1, 0], RIGHT: [1, 0] } as const;
type KeyName = keyof typeof KEYS | 'E';

export class CityScene extends Phaser.Scene {
  private map!: CityMap;
  private landmarks = new Map<string, Landmark>();
  private agents = new Map<string, Agent>();
  private player!: Agent;
  private citizens?: Citizens;
  private packets!: Packets;
  private dayNight!: DayNight;
  private plotSigns = new Map<string, Phaser.GameObjects.Text>();
  private focusRing!: Phaser.GameObjects.Graphics;
  private focusedId?: string;
  private offs: (() => void)[] = [];
  private tasks = new Map<string, { agentId: string; total: number }>();
  private dragging = false;
  private following?: Agent;
  private lastUi = 0;
  private keys: Partial<Record<KeyName, Phaser.Input.Keyboard.Key>> = {};
  private stepCount = 0;

  readonly world: AgentWorld = {
    iso: CITY_ISO,
    gridW: GRID,
    gridH: GRID,
    walkable: (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && !this.map.blocked.has(y * GRID + x),
  };

  constructor() {
    super('city');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0f1a2b').setRoundPixels(true);
    this.map = new CityMap(this);
    this.focusRing = this.add.graphics().setDepth(9_000);
    this.dayNight = new DayNight(this);
    this.packets = new Packets(this, CITY_ISO, GRID, (x, y) => this.map.isRoadTile(x, y) || this.map.isSidewalk(x, y));
    this.syncWorld(useCity.getState().progress);

    this.spawnAgent('concierge', landmarkLayout('plaza')!.workSpot, TOWN_SQUARE.rect, landmarkLayout('plaza')!.workSpot);
    this.spawnAgent('lookout', landmarkLayout('lookout')!.workSpot, LOOKOUT_HOME, landmarkLayout('lookout')!.workSpot);
    this.spawnAgent('builder', landmarkLayout('workshop')!.workSpot, TOWN_SQUARE.rect, landmarkLayout('workshop')!.workSpot);
    this.player = new Agent(this, this.world, { id: 'player', name: 'Kai (you)', tile: PLAYER_SPAWN, home: TOWN_SQUARE.rect, speed: 3, wanders: false, showTag: true });
    this.player.sprite.disableInteractive();
    this.player.onSpeak = (a) => blip(a.id);
    this.player.onStep = () => {
      this.stepCount++;
      if (this.stepCount % 2 === 0) sfx(`step${this.stepCount % 3}` as 'step0', 0.15);
    };

    this.citizens = new Citizens(
      this,
      { ...this.world, wanderable: (x, y) => this.map.isSidewalk(x, y) },
      () => {
        const out: Tile[] = [];
        for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (this.map.isSidewalk(x, y) && this.world.walkable(x, y)) out.push({ x, y });
        return out;
      },
      {
        player: () => this.player,
        lakeShore: () => (tierOf(useCity.getState().progress, 's3') >= 1 ? landmarkLayout('s3')!.workSpot : undefined),
      },
    );
    this.citizens.ensure(this.citizenTarget());

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
    const cam = this.cameras.main;
    // Text keeps one on-screen size at every zoom (it's rendered crisp, see SpeechBubble.crisp).
    const ui = 1 / cam.zoom;
    const levels = useCity.getState().agentLevels;
    for (const [id, a] of this.agents) {
      a.speedBoost = 1 + 0.15 * ((levels[id] ?? 1) - 1);
      a.update(time, dt);
      a.setUiScale(ui);
    }
    this.handleKeys();
    this.player.update(time, dt);
    this.player.setUiScale(ui);
    this.citizens?.update(time, dt);
    if (ui !== this.lastUi) {
      this.lastUi = ui;
      for (const l of this.landmarks.values()) l.setUiScale(ui);
      for (const t of this.plotSigns.values()) t.setScale(ui);
      this.citizens?.setUiScale(ui);
    }
    this.dayNight.update();
    const n = this.dayNight.night;
    for (const l of this.landmarks.values()) l.setNight(n);
    this.map.setNight(n);
  }

  // ── world building ───────────────────────────────────────────────────────

  private citizenTarget() {
    const p = useCity.getState().progress;
    return 10 + 3 * DISTRICTS.filter((d) => this.districtUnlocked(p, d.id)).length;
  }

  private districtUnlocked(p: Progress, d: DistrictId) {
    return servicesIn(d).some((s) => isDiscovered(p, s.id));
  }

  private specFor(l: LandmarkLayout, p: Progress): LandmarkSpec {
    if (l.id === 'plaza') return { id: l.id, sprite: 'spheres', footprint: l.footprint, label: 'The Spheres · Console HQ', tier: 1, showStars: false };
    if (l.id === 'lookout') return { id: l.id, sprite: 'lookout', footprint: l.footprint, label: 'Lookout', tier: 1, showStars: false };
    if (l.id === 'workshop') return { id: l.id, sprite: 'workshop', footprint: l.footprint, label: 'CloudFormation Workshop', tier: 1, showStars: false };
    const d = districtById(l.districtId!)!;
    if (l.id.startsWith('hq:')) return { id: l.id, sprite: `hq:${d.id}`, footprint: l.footprint, label: d.hq, tier: this.districtUnlocked(p, d.id) ? 1 : -1, showStars: false };
    const place = placeFor(l.id)!;
    const tier = tierOf(p, l.id);
    return { id: l.id, sprite: tier <= 0 ? 'construction3x3' : `lm:${l.id}:${tier}`, footprint: l.footprint, label: place.place, tier, showStars: true };
  }

  /** Reconcile ground, landmarks, agents and signs with progress. */
  private syncWorld(p: Progress) {
    this.map.sync(p);
    for (const l of LANDMARKS) {
      const spec = this.specFor(l, p);
      const cur = this.landmarks.get(l.id);
      if (cur && cur.spec.sprite === spec.sprite && cur.spec.tier === spec.tier) continue;
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
    this.citizens?.ensure(this.citizenTarget());
    this.lastUi = 0;
  }

  private syncPlotSigns(p: Progress) {
    const want = new Map<string, { rect: Rect; text: string }>();
    for (const d of DISTRICTS) {
      if (this.districtUnlocked(p, d.id)) continue;
      const names = servicesIn(d.id).slice(0, 3).map((s) => s.name.replace(/^(Amazon|AWS) /, '')).join(' · ');
      want.set(d.id, { rect: DISTRICT_PLOTS[d.id].rect, text: `🔒 ${d.name}\nOpen ${names}… in the AWS console` });
    }
    FUTURE_PLOTS.forEach((f, i) => want.set(f.id, { rect: f.rect, text: `🏗 ${FUTURE_LABELS[i]}` }));
    for (const [id, sign] of this.plotSigns) if (!want.has(id)) sign.destroy(), this.plotSigns.delete(id);
    for (const [id, w] of want) {
      if (this.plotSigns.has(id)) continue;
      const c = toScreen(CITY_ISO, w.rect.x + (w.rect.w - 1) / 2, w.rect.y + (w.rect.h - 1) / 2);
      this.plotSigns.set(
        id,
        crisp(
          this.add
            .text(c.x, c.y, w.text, { fontFamily: TEXT_FONT, fontSize: '13px', fontStyle: '800', align: 'center', color: '#ffe6a8', backgroundColor: '#140d1fcc', padding: { x: 8, y: 4 } })
            .setOrigin(0.5)
            .setDepth(9_600),
        ),
      );
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
    a.onSpeak = (ag) => blip(ag.id);
    this.agents.set(id, a);
    return a;
  }

  private talkTo(id: string, a: Agent) {
    const lm = id === 'concierge' ? 'plaza' : id === 'lookout' ? 'lookout' : id === 'builder' ? 'workshop' : id;
    this.select(lm);
    a.face(this.player.tile);
    a.emote('hi', 1400);
    const place = placeFor(id);
    a.say(place ? `Hi! I'm ${a.name}. ${place.blurb}` : `Hi! I'm ${a.name}.`);
    click();
  }

  // ── camera & input ───────────────────────────────────────────────────────

  private setupCamera() {
    const cam = this.cameras.main;
    const w = GRID * CITY_ISO.halfW;
    cam.setBounds(-w - 300, -400, 2 * w + 600, 2 * GRID * CITY_ISO.halfH + 700);
    cam.setZoom(2);
    const c = toScreen(CITY_ISO, TOWN_SQUARE.rect.x + 6, TOWN_SQUARE.rect.y + 6);
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
    // Integer-ish zoom steps keep pixels crisp.
    const steps = [1, 2, 3, 4];
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const nearest = steps.reduce((a, b) => (Math.abs(b - cam.zoom) < Math.abs(a - cam.zoom) ? b : a));
      const i = steps.indexOf(nearest);
      cam.zoomTo(steps[Phaser.Math.Clamp(i + (dy > 0 ? -1 : 1), 0, steps.length - 1)], 150);
    });
    const kb = this.input.keyboard;
    if (kb) {
      for (const k of [...Object.keys(KEYS), 'E'] as KeyName[]) this.keys[k] = kb.addKey(k, false);
      this.keys.E?.on('down', () => !this.typing() && this.interact());
    }
  }

  private typing() {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
  }

  private handleKeys() {
    if (this.typing()) return;
    for (const [k, [dx, dy]] of Object.entries(KEYS) as [keyof typeof KEYS, readonly [number, number]][]) {
      if (this.keys[k]?.isDown) {
        if (this.player.step(dx, dy) && this.following !== this.player) this.follow(this.player);
        return;
      }
    }
  }

  /** E: talk to the nearest agent, or enter/visit the nearest landmark. */
  private interact() {
    const p = this.player;
    let best: { d: number; fn: () => void } | undefined;
    for (const [id, a] of this.agents) {
      const d = Math.abs(a.gx - p.gx) + Math.abs(a.gy - p.gy);
      if (d <= 2 && (!best || d < best.d)) best = { d, fn: () => this.talkTo(id, a) };
    }
    for (const l of LANDMARKS) {
      const d = Math.abs(l.workSpot.x - p.gx) + Math.abs(l.workSpot.y - p.gy);
      if (this.landmarks.has(l.id) && d <= 1 && (!best || d < best.d)) best = { d, fn: () => this.onLandmarkClick(l.id) };
    }
    best?.fn();
  }

  private flyTo(id: string) {
    const l = landmarkLayout(id);
    const rect = l?.footprint ?? DISTRICT_PLOTS[id as DistrictId]?.rect;
    if (!rect) return;
    const c = toScreen(CITY_ISO, rect.x + (rect.w - 1) / 2, rect.y + (rect.h - 1) / 2);
    const cam = this.cameras.main;
    cam.stopFollow();
    this.following = undefined;
    cam.pan(c.x, c.y - 30, 700, 'Sine.easeInOut');
  }

  private follow(a: Agent) {
    this.following = a;
    this.cameras.main.startFollow(a.sprite, true, 0.08, 0.08);
  }

  private highlight(id?: string) {
    this.focusedId = id;
    this.focusRing.clear();
    this.tweens.killTweensOf(this.focusRing);
    const l = id ? landmarkLayout(id) : undefined;
    if (!l) return;
    const f = l.footprint;
    const pts = [cornerScreen(CITY_ISO, f.x, f.y), cornerScreen(CITY_ISO, f.x + f.w, f.y), cornerScreen(CITY_ISO, f.x + f.w, f.y + f.h), cornerScreen(CITY_ISO, f.x, f.y + f.h)].map(
      (v) => new Phaser.Math.Vector2(v.x, v.y),
    );
    this.focusRing.lineStyle(2, 0xfde047, 1).strokePoints(pts, true);
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
        sfx('door', 0.5);
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
        const a = this.agents.get(serviceId);
        a?.say(`We just reached ${TIER_NAMES[tier]}! ⭐`, { tone: 'done' });
        a?.emote('jump', 1200);
        this.burst(serviceId);
        sfx('levelup', 0.5);
      }),
      bus.on('snap', ({ phase }) => this.onSnap(phase)),
      bus.on('xpGained', ({ serviceId, amount }) => this.floatText(serviceId, `+${amount} XP`)),
      bus.on('hour', ({ hour }) => {
        this.dayNight.forcedHour = hour;
      }),
      bus.on('showFlow', ({ serviceIds }) => this.showFlow(serviceIds)),
    );
  }

  private teardown() {
    for (const off of this.offs) off();
    this.offs = [];
  }

  private agentTile(id: string): Tile | undefined {
    if (id === 'user') return this.player.tile;
    return this.agents.get(id)?.tile;
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
        if (e.status === 'skipped') a.say(`⤼ ${e.text}`, { tone: 'done', holdMs: 2500 });
        if (e.status === 'failed') a.say(`✗ ${e.text}`, { tone: 'alert' });
        break;
      }
      case 'agent.state': {
        const a = this.agents.get(e.agentId);
        if (!a) return;
        a.setDetail(e.state === 'working' ? e.detail : undefined);
        a.setWorking(e.state === 'working');
        if (e.state === 'working') sfx('work', 0.05);
        break;
      }
      case 'agent.message': {
        const from = this.agents.get(e.from);
        if (!from) return;
        const to = e.to === 'user' ? 'you' : agentName(e.to);
        from.say(e.text, { caption: `→ ${to}` });
        const a = this.agentTile(e.from);
        const b = this.agentTile(e.to);
        if (a && b) this.packets.send(a, b, this.colorOf(e.from));
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
        if (e.ok) {
          a.emote('jump', 1000);
          chime();
          this.burst(t.agentId);
        }
        if (this.following === a) this.time.delayedCall(2500, () => this.following === a && (this.cameras.main.stopFollow(), (this.following = undefined)));
        break;
      }
      case 'deploy.status':
        if (e.status === 'complete') {
          sfx('deploy', 0.5);
          this.burst('workshop');
          this.agents.get('builder')?.emote('jump', 1200);
        }
        break;
      case 'agent.level':
        this.agents.get(e.agentId)?.say(`Level ${e.level}! ${e.skill ?? ''}`, { tone: 'done' });
        sfx('levelup', 0.4);
        break;
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
      a?.emote('wave', 1600);
      a?.say(`You’re on my page! ${placeFor(f.serviceId)?.teaches[0] ?? ''}`);
      return;
    }
    this.highlight(undefined);
    if (f.kind === 'other' && !useCity.getState().autoSnap) this.agents.get('lookout')?.say('New page! Press 📷 and I’ll show it to the city.', { holdMs: 3000 });
  }

  private onDiscovered(serviceId: string) {
    this.flyTo(serviceId);
    this.highlight(serviceId);
    sfx('discover', 0.5);
    const a = this.agents.get(serviceId);
    if (!a) return;
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

  /** Animate an architecture: packets hop between the listed services in order. */
  private showFlow(ids: string[]) {
    const tiles = ids.map((id) => landmarkLayout(id)?.workSpot).filter((t): t is Tile => !!t);
    tiles.slice(1).forEach((t, i) => this.time.delayedCall(i * 900, () => this.packets.send(tiles[i], t, this.colorOf(ids[i]))));
    if (ids[0]) this.flyTo(ids[0]);
  }

  // ── juice ────────────────────────────────────────────────────────────────

  private anchorFor(id: string) {
    const l = landmarkLayout(id);
    if (!l) return undefined;
    return toScreen(CITY_ISO, l.footprint.x + (l.footprint.w - 1) / 2, l.footprint.y + (l.footprint.h - 1) / 2);
  }

  private floatText(id: string, text: string) {
    const c = this.anchorFor(id);
    if (!c) return;
    const t = crisp(this.add.text(c.x, c.y - 24, text, { fontFamily: TEXT_FONT, fontSize: '14px', fontStyle: '900', color: '#ffb84d', stroke: '#140d1f', strokeThickness: 4 }))
      .setOrigin(0.5)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(58_000);
    this.tweens.add({ targets: t, y: c.y - 60, alpha: 0, duration: 1600, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private burst(id: string) {
    const c = this.anchorFor(id);
    if (!c) return;
    const colors = [0xfde047, 0xf472b6, 0x60a5fa, 0x34d399, 0xff9900];
    for (let i = 0; i < 16; i++) {
      const r = this.add.rectangle(c.x, c.y - 30, 3, 3, colors[i % colors.length]).setDepth(58_000);
      const ang = (i / 16) * Math.PI * 2;
      this.tweens.add({ targets: r, x: c.x + Math.cos(ang) * 50, y: c.y - 30 + Math.sin(ang) * 30 - 24, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => r.destroy() });
    }
  }
}
