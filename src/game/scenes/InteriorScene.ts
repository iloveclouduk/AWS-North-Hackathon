import Phaser from 'phaser';
import type { ServerEvent } from '@/backend/contract';
import { bus } from '@/state/bus';
import { isDiscovered, useCity } from '@/state/store';
import type { Tile } from '@/world/layout';
import { placeFor } from '@/world/places';
import { districtById, servicesIn, type DistrictId } from '@/world/taxonomy';
import { Agent, type AgentWorld } from '../Agent';
import { addSprite, CITY_ATLAS } from '../assets';
import { blip, sfx } from '../audio';
import { castFor } from '../cast';
import { cornerScreen, entityDepth, ROOM_ISO, toScreen, toTile } from '../iso';
import { crisp, TEXT_FONT } from '../SpeechBubble';

const W = 10;
const H = 9;
const DOOR: Tile = { x: 0, y: 7 };
/** Chairs (agent sits here facing SE) — the pack's desk with computer is one tile SE of each. */
const SEATS: Tile[] = [
  { x: 2, y: 2 },
  { x: 5, y: 2 },
  { x: 2, y: 5 },
  { x: 5, y: 5 },
  { x: 2, y: 8 },
  { x: 5, y: 8 },
];

type Piece = [sprite: string, x: number, y: number];

/** Back walls, in the pack's style: [sprite, index along the wall]. Two-tile pieces take two slots. */
const RIGHT_WALL: Record<string, string[]> = {
  default: ['pack:server_right', 'pack:dashboard_right', '', 'wallR', 'pack:poster_lambda_right', 'pack:server_right', 'pack:dashboard_right', '', 'wallR', 'pack:server_right'],
  spheres: ['pack:dashboard_right', '', 'wallR', 'wallR', 'pack:poster_lambda_right', 'wallR', 'pack:dashboard_right', '', 'wallR', 'wallR'],
};
const LEFT_WALL: Record<string, string[]> = {
  default: ['pack:window_left', '', 'pack:poster_lambda_left', 'pack:dashboard_left', '', 'pack:server_left', 'wallL', 'DOOR', 'wallL'],
  spheres: ['pack:window_left', '', 'pack:window_left', '', 'pack:window_left', '', 'wallL', 'DOOR', 'wallL'],
};

const FURNITURE: Record<string, Piece[]> = {
  compute: [['pack:server_rack_SW', 9, 1], ['pack:server_rack_SW', 9, 2], ['pack:server_rack_SW', 9, 3], ['pack:server_rack_SW', 9, 4]],
  storage: [['pack:data_box_SW', 9, 1], ['pack:data_box_SW', 9, 2], ['pack:server_rack_SW', 9, 4]],
  database: [['pack:server_rack_SW', 9, 1], ['pack:server_rack_SW', 9, 2], ['pack:data_box_SW', 9, 4]],
  networking: [['pack:server_rack_SW', 9, 1], ['pack:lambda_sign_SW', 9, 3]],
  security: [['pack:server_rack_SW', 9, 1], ['pack:data_box_SW', 9, 3]],
  aiml: [['pack:server_rack_SW', 9, 1], ['pack:server_rack_SW', 9, 2], ['pack:lambda_sign_SW', 9, 4]],
};
const COMMON: Piece[] = [['pack:coffee_machine_SW', 9, 7], ['plant', 9, 8], ['plant', 1, 0], ['sofa', 7, 8]];
const SPHERES: Piece[] = [
  ['tree0', 1, 1], ['tree1', 3, 1], ['pine', 8, 1], ['tree0', 9, 3], ['tree1', 9, 6], ['plant', 1, 4], ['plant', 7, 4], ['plant', 4, 7],
  ['flowers', 3, 4], ['flowers', 6, 6], ['benchX', 7, 6], ['benchY', 2, 6], ['pack:coffee_machine_SW', 9, 8], ['awsSign', 5, 1],
];

export class InteriorScene extends Phaser.Scene {
  private districtId!: string;
  private agents = new Map<string, Agent>();
  private player!: Agent;
  private blocked = new Set<number>();
  private offs: (() => void)[] = [];
  private answers = new Map<string, string>();
  private title?: Phaser.GameObjects.Text;

  readonly world: AgentWorld = {
    iso: ROOM_ISO,
    gridW: W,
    gridH: H,
    walkable: (x, y) => x >= 0 && y >= 0 && x < W && y < H && !this.blocked.has(y * W + x),
  };

  constructor() {
    super('interior');
  }

  init(data: { districtId: string }) {
    this.districtId = data.districtId;
    this.agents = new Map();
    this.blocked = new Set();
    this.answers = new Map();
    this.offs = [];
  }

  preload() {
    if (!this.textures.exists('door')) this.load.spritesheet('door', '/assets/city/door_left.png', { frameWidth: 40, frameHeight: 64 });
  }

  create() {
    const spheres = this.districtId === 'spheres';
    const d = spheres ? undefined : districtById(this.districtId);
    this.cameras.main.setBackgroundColor('#0d0816').setRoundPixels(true);

    // floor
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const n = cornerScreen(ROOM_ISO, x, y);
        let f = spheres ? ((x * 7 + y * 3) % 5 === 0 ? 'grass0' : 'floorTile') : x >= 8 ? 'floorGrate' : 'carpet';
        if (!spheres && x >= 6 && x <= 8 && y >= 7) f = 'floorTile';
        this.add.image(n.x, n.y, CITY_ATLAS, f).setOrigin(0.5, 0).setDepth(x + y);
      }

    // back walls
    const rw = RIGHT_WALL[spheres ? 'spheres' : 'default'];
    rw.forEach((name, x) => name && x < W && addSprite(this, name, cornerScreen(ROOM_ISO, x, 0).x, cornerScreen(ROOM_ISO, x, 0).y).setDepth(-5));
    const lw = LEFT_WALL[spheres ? 'spheres' : 'default'];
    lw.forEach((name, y) => {
      if (!name || y >= H || name === 'DOOR') return;
      const n = cornerScreen(ROOM_ISO, 0, y);
      addSprite(this, name, n.x, n.y).setDepth(-5);
    });
    // the team's animated door on the left wall
    const dp = toScreen(ROOM_ISO, -0.5, DOOR.y + 0.5);
    addSprite(this, 'wallL', cornerScreen(ROOM_ISO, 0, DOOR.y).x, cornerScreen(ROOM_ISO, 0, DOOR.y).y).setDepth(-6);
    const door = this.add.sprite(dp.x, dp.y, 'door', 0).setOrigin(8 / 40, 52 / 64).setDepth(-4);

    for (const [key, x, y] of spheres ? SPHERES : [...(FURNITURE[this.districtId] ?? []), ...COMMON]) this.furniture(key, x, y);

    // who works here
    const staff: string[] = spheres
      ? ['concierge', 'builder', 'lookout']
      : servicesIn(this.districtId as DistrictId)
          .filter((s) => isDiscovered(useCity.getState().progress, s.id))
          .map((s) => s.id);
    staff.forEach((_, i) => {
      const seat = SEATS[i];
      this.furniture('pack:desk_computer_SE', seat.x + 1, seat.y);
      const n = cornerScreen(ROOM_ISO, seat.x, seat.y);
      addSprite(this, 'pack:office_chair_SE', n.x, n.y).setDepth(entityDepth(toScreen(ROOM_ISO, seat.x, seat.y).y) - 2);
    });

    const titleText = spheres ? 'The Spheres · Console HQ — tell the Concierge what you want to build or learn' : `${d!.hq} · ${d!.name}`;
    const t0 = toScreen(ROOM_ISO, 0, 0);
    this.title = crisp(
      this.add
        .text(t0.x + 40, t0.y - 96, titleText, { fontFamily: TEXT_FONT, fontSize: '12px', fontStyle: '800', color: '#fff8ec', backgroundColor: '#140d1fdd', padding: { x: 8, y: 4 } })
        .setOrigin(0.5, 1)
        .setDepth(70_000),
    );

    staff.forEach((id, i) => {
      const c = castFor(id)!;
      const a = new Agent(this, this.world, {
        id,
        name: c.name,
        tile: { x: 3 + (i % 3), y: 4 },
        home: { x: 1, y: 3, w: 7, h: 5 },
        workSpot: SEATS[i],
        workAnim: 'sit',
        workDir: 'SE',
        speed: 1.6,
      });
      a.onSpeak = (ag) => blip(ag.id);
      a.onClick(() => {
        useCity.getState().select(id === 'concierge' ? 'plaza' : id);
        bus.emit('select', { id });
        a.face(this.player.tile);
        a.emote('hi', 1400);
        a.say(spheres ? 'Tell me what you want to do — type it below and I’ll send the right agent!' : `Ask me anything about ${placeFor(id)?.place}! Use the chat.`);
      });
      this.agents.set(id, a);
      if (useCity.getState().agents[id]?.state === 'working') this.time.delayedCall(200, () => a.setWorking(true));
    });

    this.player = new Agent(this, this.world, { id: 'player', name: 'Kai (you)', tile: DOOR, home: { x: 0, y: 0, w: W, h: H }, speed: 2.4, wanders: false });
    this.player.sprite.disableInteractive();
    door.setFrame(3);
    sfx('door', 0.4);
    this.time.delayedCall(250, () => this.player.goTo({ x: 2, y: 7 }, () => door.setFrame(0)));

    const lead = this.agents.values().next().value as Agent | undefined;
    this.time.delayedCall(800, () =>
      lead?.say(spheres ? 'Welcome to The Spheres! Type a request below — I’ll dispatch the right agent in the city.' : `Welcome to ${d!.hq}! We sit at our desks when real AWS calls run. Ask us anything below.`, {
        holdMs: 5000,
      }),
    );

    this.setupCamera();
    this.input.on('pointerup', (ptr: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length || ptr.getDistance() > 8) return;
      const t = toTile(ROOM_ISO, ptr.worldX, ptr.worldY);
      if (t.x === DOOR.x && t.y === DOOR.y) {
        this.player.goTo(DOOR, () => useCity.getState().setView({ name: 'city' }));
        return;
      }
      if (this.world.walkable(t.x, t.y)) this.player.goTo(t);
    });

    this.offs.push(bus.on('server', (e) => this.onServer(e)));
    const teardown = () => {
      for (const off of this.offs) off();
      this.offs = [];
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);
    this.events.once(Phaser.Scenes.Events.DESTROY, teardown);
  }

  override update(time: number, dt: number) {
    const ui = 1 / this.cameras.main.zoom;
    this.title?.setScale(ui);
    for (const a of this.agents.values()) {
      a.update(time, dt);
      a.setUiScale(ui);
    }
    this.player.update(time, dt);
    this.player.setUiScale(ui);
  }

  private setupCamera() {
    const cam = this.cameras.main;
    const c = toScreen(ROOM_ISO, W / 2 - 0.5, H / 2 - 0.5);
    const fit = () => {
      const z = Math.min(this.scale.width / 360, this.scale.height / 300);
      cam.setZoom(Phaser.Math.Clamp(Math.floor(z + 0.3), 1, 4));
      cam.centerOn(c.x, c.y - 24);
    };
    fit();
    this.scale.on('resize', fit);
    this.offs.push(() => this.scale.off('resize', fit));
  }

  private furniture(key: string, x: number, y: number) {
    const n = cornerScreen(ROOM_ISO, x, y);
    addSprite(this, key, n.x, n.y).setDepth(entityDepth(toScreen(ROOM_ISO, x, y).y));
    if (key === 'sofa') this.blocked.add(y * W + x + 1);
    if (key !== 'flowers') this.blocked.add(y * W + x);
  }

  private onServer(e: ServerEvent) {
    switch (e.type) {
      case 'agent.state':
        this.agents.get(e.agentId)?.setDetail(e.state === 'working' ? e.detail : undefined);
        this.agents.get(e.agentId)?.setWorking(e.state === 'working');
        break;
      case 'agent.message':
        this.agents.get(e.from)?.say(e.text);
        break;
      case 'chat.answer': {
        if (e.districtId !== this.districtId) return;
        const text = (this.answers.get(e.requestId) ?? '') + e.delta;
        this.answers.set(e.requestId, text);
        if (e.done) {
          const a = this.agents.get(e.agentId) ?? this.agents.values().next().value;
          a?.say(text.length > 160 ? text.slice(0, 157) + '…' : text, { holdMs: 7000 });
        }
        break;
      }
    }
  }
}
