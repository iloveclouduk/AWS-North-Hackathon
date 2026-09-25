import Phaser from 'phaser';
import type { ServerEvent } from '@/backend/contract';
import { bus } from '@/state/bus';
import { isDiscovered, useCity } from '@/state/store';
import type { Tile } from '@/world/layout';
import { placeFor } from '@/world/places';
import { districtById, servicesIn, type DistrictId } from '@/world/taxonomy';
import { Agent, type AgentWorld } from '../Agent';
import { addSprite, CITY_ATLAS } from '../assets';
import { sfx } from '../audio';
import { castFor } from '../cast';
import { cornerScreen, entityDepth, ROOM_ISO, toScreen, toTile } from '../iso';
import { PIXEL_FONT } from '../SpeechBubble';

const W = 9;
const H = 8;
const DOOR: Tile = { x: 0, y: 6 };
/** Chairs where agents sit and type while their AWS calls run. */
const SEATS: Tile[] = [
  { x: 2, y: 2 },
  { x: 4, y: 2 },
  { x: 6, y: 2 },
  { x: 2, y: 5 },
  { x: 4, y: 5 },
  { x: 6, y: 5 },
];

/** Furniture per district: [sprite, x, y]. Generated pixel art (art/tiles). */
const FURNITURE: Record<DistrictId, [string, number, number][]> = {
  compute: [['rack0', 8, 0], ['rack1', 8, 1], ['rack0', 8, 2], ['rack1', 8, 3]],
  storage: [['bookshelf', 8, 0], ['rack0', 8, 1], ['plant', 8, 3]],
  database: [['bookshelf', 8, 0], ['bookshelf', 8, 1], ['bookshelf', 8, 2], ['plant', 8, 3]],
  networking: [['rack1', 8, 0], ['whiteboard', 8, 1], ['plant', 8, 3]],
  security: [['rack0', 8, 0], ['bookshelf', 8, 1], ['plant', 8, 3]],
  aiml: [['whiteboard', 8, 0], ['whiteboard', 8, 1], ['rack1', 8, 2], ['plant', 8, 3]],
};
const COMMON: [string, number, number][] = [
  ['sofa', 5, 7],
  ['cooler', 8, 5],
  ['plant', 1, 0],
  ['plant', 8, 7],
];

export class InteriorScene extends Phaser.Scene {
  private districtId!: DistrictId;
  private agents = new Map<string, Agent>();
  private player!: Agent;
  private blocked = new Set<number>();
  private offs: (() => void)[] = [];
  private answers = new Map<string, string>();
  private racks: Phaser.GameObjects.Image[] = [];

  readonly world: AgentWorld = {
    iso: ROOM_ISO,
    gridW: W,
    gridH: H,
    walkable: (x, y) => x >= 0 && y >= 0 && x < W && y < H && !this.blocked.has(y * W + x),
  };

  constructor() {
    super('interior');
  }

  init(data: { districtId: DistrictId }) {
    this.districtId = data.districtId;
    this.agents = new Map();
    this.blocked = new Set();
    this.answers = new Map();
    this.racks = [];
    this.offs = [];
  }

  preload() {
    if (!this.textures.exists('door')) this.load.spritesheet('door', '/assets/city/door_left.png', { frameWidth: 40, frameHeight: 64 });
  }

  create() {
    const d = districtById(this.districtId)!;
    this.cameras.main.setBackgroundColor('#0b1220').setRoundPixels(true);

    // floor + a rug under the meeting area
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const n = cornerScreen(ROOM_ISO, x, y);
        const rug = x >= 3 && x <= 5 && y >= 6;
        this.add.image(n.x, n.y, CITY_ATLAS, rug ? 'carpet' : 'floorWood').setOrigin(0.5, 0).setDepth(x + y);
      }
    // back walls with windows, tinted to the district
    for (let x = 0; x < W; x++) {
      const n = cornerScreen(ROOM_ISO, x, 0);
      addSprite(this, x % 3 === 1 ? 'wallRWin' : 'wallR', n.x, n.y).setDepth(-5).setTint(tintFor(d.color, 0.25));
    }
    for (let y = 0; y < H; y++) {
      const n = cornerScreen(ROOM_ISO, 0, y);
      addSprite(this, y % 3 === 1 ? 'wallLWin' : 'wallL', n.x, n.y).setDepth(-5).setTint(tintFor(d.color, 0.15));
    }
    // the team's animated door on the left wall
    const dp = toScreen(ROOM_ISO, -0.5, DOOR.y + 0.75);
    const door = this.add.sprite(dp.x, dp.y, 'door', 0).setOrigin(8 / 40, 52 / 64).setDepth(-4);

    for (const [key, x, y] of [...FURNITURE[this.districtId], ...COMMON]) this.furniture(key, x, y);

    // workstations: a chair per discovered agent, desk in front
    const staff = servicesIn(this.districtId).filter((s) => isDiscovered(useCity.getState().progress, s.id));
    staff.forEach((s, i) => {
      const seat = SEATS[i];
      this.furniture('desk', seat.x + 1, seat.y);
      const n = cornerScreen(ROOM_ISO, seat.x, seat.y);
      addSprite(this, 'chair', n.x, n.y).setDepth(entityDepth(toScreen(ROOM_ISO, seat.x, seat.y).y) - 2);
    });

    const title = toScreen(ROOM_ISO, 0, 0);
    this.add
      .text(title.x + 60, title.y - 140, `${d.hq} · ${d.name}`, { fontFamily: PIXEL_FONT, fontSize: '16px', color: '#ffffff', backgroundColor: '#161622d9', padding: { x: 6, y: 1 } })
      .setOrigin(0.5, 1)
      .setDepth(70_000);

    staff.forEach((s, i) => {
      const c = castFor(s.id)!;
      const a = new Agent(this, this.world, {
        id: s.id,
        name: c.name,
        tile: { x: 3 + (i % 3), y: 4 },
        home: { x: 1, y: 3, w: 6, h: 4 },
        workSpot: SEATS[i],
        workAnim: 'type',
        workDir: 'SE',
        speed: 1.6,
      });
      a.onClick(() => {
        useCity.getState().select(s.id);
        bus.emit('select', { id: s.id });
        a.face(this.player.tile);
        a.emote('hi', 1400);
        a.say(`Ask me anything about ${placeFor(s.id)?.place}! Use the chat.`);
      });
      this.agents.set(s.id, a);
      if (useCity.getState().agents[s.id]?.state === 'working') this.time.delayedCall(200, () => a.setWorking(true));
    });

    // Kai walks in through the door
    this.player = new Agent(this, this.world, { id: 'player', name: 'Kai (you)', tile: { x: 0, y: DOOR.y }, home: { x: 0, y: 0, w: W, h: H }, speed: 2.4, wanders: false });
    this.player.sprite.disableInteractive();
    door.setFrame(3);
    sfx('door', 0.4);
    this.time.delayedCall(250, () => this.player.goTo({ x: 2, y: 7 }, () => door.setFrame(0)));

    const lead = this.agents.values().next().value as Agent | undefined;
    this.time.delayedCall(800, () => lead?.say(`Welcome to ${d.hq}! We sit and type when real AWS calls run. Ask us anything below.`, { holdMs: 5000 }));

    this.time.addEvent({ delay: 350, loop: true, callback: () => this.racks.forEach((r) => r.setFrame(r.frame.name === 'rack0' ? 'rack1' : 'rack0')) });
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
    for (const a of this.agents.values()) a.update(time, dt);
    this.player.update(time, dt);
  }

  private setupCamera() {
    const cam = this.cameras.main;
    const c = toScreen(ROOM_ISO, W / 2 - 0.5, H / 2 - 0.5);
    const fit = () => {
      const z = Math.min(this.scale.width / 640, this.scale.height / 520);
      cam.setZoom(Phaser.Math.Clamp(Math.floor(z * 4) / 4, 0.5, 2));
      cam.centerOn(c.x, c.y - 40);
    };
    fit();
    this.scale.on('resize', fit);
    this.offs.push(() => this.scale.off('resize', fit));
  }

  private furniture(key: string, x: number, y: number) {
    const n = cornerScreen(ROOM_ISO, x, y);
    const img = addSprite(this, key, n.x, n.y).setDepth(entityDepth(toScreen(ROOM_ISO, x, y).y));
    if (key.startsWith('rack')) this.racks.push(img);
    if (key === 'sofa') this.blocked.add(y * W + x + 1);
    this.blocked.add(y * W + x);
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
          a?.say(text.length > 140 ? text.slice(0, 137) + '…' : text, { holdMs: 7000 });
          sfx('pop', 0.3);
        }
        break;
      }
    }
  }
}

/** Soft wall tint from a district colour (mixed towards white). */
function tintFor(color: number, amount: number) {
  const ch = (s: number) => Math.round(255 - (255 - ((color >> s) & 255)) * amount);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
