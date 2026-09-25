import Phaser from 'phaser';
import type { ServerEvent } from '@/backend/contract';
import { bus } from '@/state/bus';
import { isDiscovered, useCity } from '@/state/store';
import type { Tile } from '@/world/layout';
import { placeFor } from '@/world/places';
import { districtById, servicesIn, type DistrictId } from '@/world/taxonomy';
import { Agent, type AgentWorld } from '../Agent';
import { MINI_ORIGIN_Y, MINI_SCALE, type RoomSprite } from '../assets';
import { castFor } from '../cast';
import { entityDepth, ROOM_ISO, toScreen, toTile } from '../iso';
import { IsoPainter, shade } from '../Landmark';
import { UI_FONT } from '../SpeechBubble';

const W = 8;
const H = 8;
const WALL_H = 150;
const DOOR: Tile = { x: 0, y: 6 };
/** Seats at the workstations along the back of the room. */
const SEATS: Tile[] = [
  { x: 1, y: 2 },
  { x: 3, y: 2 },
  { x: 5, y: 2 },
];

/** Furniture per district: [sprite, tile]. Kenney miniatures, CC0. */
const FURNITURE: Record<DistrictId, [RoomSprite, number, number][]> = {
  storage: [['crates', 7, 0], ['barrels', 7, 1], ['chest', 6, 6], ['bookcase', 7, 3]],
  compute: [['crates', 7, 0], ['barrels', 6, 6], ['crates', 7, 5], ['bookcaseSide', 0, 2]],
  database: [['bookcase', 7, 0], ['bookcase', 7, 2], ['bookStand', 6, 6], ['bookcaseSide', 0, 2]],
  networking: [['roundTable', 6, 6], ['displayCase', 7, 0], ['bookcase', 7, 2]],
  security: [['chest', 7, 0], ['displayCase', 7, 2], ['chest', 6, 6], ['candle', 0, 3]],
  aiml: [['bookStand', 7, 0], ['candle', 7, 2], ['displayCase', 6, 6], ['bookcaseSide', 0, 2]],
};

export class InteriorScene extends Phaser.Scene {
  private districtId!: DistrictId;
  private agents = new Map<string, Agent>();
  private player!: Agent;
  private monitors = new Map<string, { g: Phaser.GameObjects.Graphics; seat: Tile }>();
  private blocked = new Set<number>();
  private offs: (() => void)[] = [];
  private answers = new Map<string, string>();

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
    this.monitors = new Map();
    this.blocked = new Set();
    this.answers = new Map();
  }

  create() {
    const d = districtById(this.districtId)!;
    this.cameras.main.setBackgroundColor('#0b1220');

    // floor
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = toScreen(ROOM_ISO, x, y);
        this.add.image(s.x, s.y, 'k:floorPlanks').setOrigin(0.5, MINI_ORIGIN_Y).setScale(MINI_SCALE).setDepth(x + y);
      }
    const carpet = toScreen(ROOM_ISO, 3.5, 5);
    this.add.image(carpet.x, carpet.y, 'k:carpet').setOrigin(0.5, MINI_ORIGIN_Y).setScale(MINI_SCALE * 1.6).setDepth(100);

    this.drawWalls(d.color);

    // meeting table in the middle
    this.furniture('longTable', 3, 5);
    for (const [key, x, y] of FURNITURE[this.districtId]) this.furniture(key, x, y);

    // workstations
    const staff = servicesIn(this.districtId).filter((s) => isDiscovered(useCity.getState().progress, s.id));
    staff.forEach((s, i) => this.workstation(s.id, SEATS[i]));

    // title
    const title = toScreen(ROOM_ISO, 0, 0);
    this.add
      .text(title.x, title.y - WALL_H - 40, `${d.hq} · ${d.name}`, { fontFamily: UI_FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#161622d9', padding: { x: 8, y: 4 }, resolution: 2 })
      .setOrigin(0.5, 1)
      .setDepth(70_000);

    // agents
    staff.forEach((s, i) => {
      const c = castFor(s.id)!;
      const a = new Agent(this, this.world, {
        id: s.id, name: c.name, look: c.look, tile: { x: 2 + i, y: 4 }, home: { x: 1, y: 3, w: 6, h: 4 },
        workSpot: SEATS[i], workAnim: 'type', speed: 1.8,
      });
      a.onClick(() => {
        useCity.getState().select(s.id);
        bus.emit('select', { id: s.id });
        a.say(`Ask me anything about ${placeFor(s.id)?.place}! Use the chat below.`);
      });
      this.agents.set(s.id, a);
      if (useCity.getState().agents[s.id]?.state === 'working') this.time.delayedCall(200, () => this.setWorking(s.id, true));
    });

    const p = castFor('player')!;
    this.player = new Agent(this, this.world, { id: 'player', name: 'You', look: p.look, tile: DOOR, home: { x: 0, y: 0, w: W, h: H }, speed: 2.6, wanders: false });
    this.player.goTo({ x: 2, y: 6 });

    const lead = this.agents.values().next().value as Agent | undefined;
    this.time.delayedCall(700, () => lead?.say(`Welcome to ${d.hq}! We sit at our computers when real AWS calls run. Ask us a question below.`, { holdMs: 5000 }));

    this.setupCamera();
    this.input.on('pointerup', (ptr: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length || ptr.getDistance() > 8) return;
      const t = toTile(ROOM_ISO, ptr.worldX, ptr.worldY);
      if (this.world.walkable(t.x, t.y)) this.player.goTo(t);
    });

    // Screens of working agents flicker with "code".
    this.time.addEvent({ delay: 300, loop: true, callback: () => this.agents.forEach((a, id) => a.isWorking && this.drawStation(id, true)) });
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
      cam.setZoom(Phaser.Math.Clamp(Math.min(this.scale.width / 1150, this.scale.height / 820), 0.35, 1.1));
      cam.centerOn(c.x, c.y - 50);
    };
    fit();
    this.scale.on('resize', fit);
    this.offs.push(() => this.scale.off('resize', fit));
  }

  private furniture(key: RoomSprite, x: number, y: number) {
    const s = toScreen(ROOM_ISO, x, y);
    this.add.image(s.x, s.y, `k:${key}`).setOrigin(0.5, MINI_ORIGIN_Y).setScale(MINI_SCALE).setDepth(entityDepth(s.y));
    this.blocked.add(y * W + x);
  }

  private drawWalls(color: number) {
    const g = this.add.graphics().setDepth(1);
    const P = new IsoPainter(g, ROOM_ISO);
    const wall = shade(color, 1.35) & 0xffffff;
    const light = mix(wall, 0xffffff, 0.55);
    // back-right wall (along y = -0.5) and back-left wall (along x = -0.5)
    P.poly([P.p(-0.5, -0.5, 0), P.p(W - 0.5, -0.5, 0), P.p(W - 0.5, -0.5, WALL_H), P.p(-0.5, -0.5, WALL_H)], shade(light, 0.9));
    P.poly([P.p(-0.5, -0.5, 0), P.p(-0.5, H - 0.5, 0), P.p(-0.5, H - 0.5, WALL_H), P.p(-0.5, -0.5, WALL_H)], light);
    // skirting + top trim
    P.poly([P.p(-0.5, -0.5, 0), P.p(W - 0.5, -0.5, 0), P.p(W - 0.5, -0.5, 10), P.p(-0.5, -0.5, 10)], shade(color, 0.8));
    P.poly([P.p(-0.5, -0.5, 0), P.p(-0.5, H - 0.5, 0), P.p(-0.5, H - 0.5, 10), P.p(-0.5, -0.5, 10)], shade(color, 0.9));
    P.poly([P.p(-0.5, -0.5, WALL_H), P.p(W - 0.5, -0.5, WALL_H), P.p(W - 0.5, -0.7, WALL_H + 8), P.p(-0.7, -0.7, WALL_H + 8)], shade(color, 0.7));
    P.poly([P.p(-0.5, -0.5, WALL_H), P.p(-0.5, H - 0.5, WALL_H), P.p(-0.7, H - 0.5, WALL_H + 8), P.p(-0.7, -0.7, WALL_H + 8)], shade(color, 0.85));
    // windows on the back-right wall
    for (const wx of [2, 5]) {
      P.poly([P.p(wx - 0.4, -0.5, 60), P.p(wx + 0.4, -0.5, 60), P.p(wx + 0.4, -0.5, 120), P.p(wx - 0.4, -0.5, 120)], 0x7dd3fc);
      P.poly([P.p(wx - 0.02, -0.5, 60), P.p(wx + 0.02, -0.5, 60), P.p(wx + 0.02, -0.5, 120), P.p(wx - 0.02, -0.5, 120)], 0xffffff);
    }
    // door on the left wall
    P.poly([P.p(-0.5, DOOR.y - 0.4, 0), P.p(-0.5, DOOR.y + 0.4, 0), P.p(-0.5, DOOR.y + 0.4, 90), P.p(-0.5, DOOR.y - 0.4, 90)], 0x5b3a1e);
    const knob = P.p(-0.5, DOOR.y + 0.25, 45);
    g.fillStyle(0xfacc15, 1).fillCircle(knob.x, knob.y, 3);
    // district poster
    P.poly([P.p(-0.5, 2.6, 70), P.p(-0.5, 3.8, 70), P.p(-0.5, 3.8, 125), P.p(-0.5, 2.6, 125)], color);
  }

  /** Desk + monitor to the screen-right of a seat; the monitor glows while its agent works. */
  private workstation(agentId: string, seat: Tile) {
    const g = this.add.graphics();
    g.setDepth(entityDepth(toScreen(ROOM_ISO, seat.x, seat.y).y) - 3);
    this.monitors.set(agentId, { g, seat });
    this.drawStation(agentId, false);
    for (const [x, y] of [[seat.x, seat.y - 1], [seat.x + 1, seat.y - 1], [seat.x + 1, seat.y]]) this.blocked.add(y * W + x);
  }

  private drawStation(agentId: string, on: boolean) {
    const m = this.monitors.get(agentId);
    if (!m) return;
    const g = m.g.clear();
    const P = new IsoPainter(g, ROOM_ISO);
    const cx = m.seat.x + 0.55;
    const cy = m.seat.y - 0.55;
    // desk
    P.boxAt(cx, cy, 0.8, 0, 34, 0x8b5a2b);
    // monitor (thin box) with a screen on its left (seat-facing) face
    const mon = P.box({ x: cx + 0.15, y: cy - 0.35 + 0.5, w: 0.12, h: 0.7 }, 38, 72, 0x1f2937);
    P.boxAt(cx + 0.21, cy, 0.12, 34, 40, 0x374151);
    const screen = on ? 0x22d3ee : 0x0f172a;
    P.poly([P.p(mon.x0, mon.y1 - 0.05, 41), P.p(mon.x0, mon.y0 + 0.05, 41), P.p(mon.x0, mon.y0 + 0.05, 69), P.p(mon.x0, mon.y1 - 0.05, 69)], screen);
    if (on) {
      for (let i = 0; i < 4; i++) {
        const z = 46 + i * 5;
        P.poly([P.p(mon.x0, mon.y1 - 0.12, z), P.p(mon.x0, mon.y1 - 0.12 - 0.1 - Math.random() * 0.35, z), P.p(mon.x0, mon.y1 - 0.12 - 0.1, z + 2), P.p(mon.x0, mon.y1 - 0.12, z + 2)], 0xecfeff);
      }
    }
    // keyboard
    P.box({ x: cx - 0.2 + 0.5 - 0.15, y: cy + 0.5 - 0.2, w: 0.2, h: 0.4 }, 34, 36, 0xd1d5db);
  }

  private setWorking(id: string, on: boolean) {
    const a = this.agents.get(id);
    if (!a) return;
    a.setWorking(on);
    this.drawStation(id, on);
  }

  private onServer(e: ServerEvent) {
    switch (e.type) {
      case 'agent.state':
        this.agents.get(e.agentId)?.setDetail(e.state === 'working' ? e.detail : undefined);
        this.setWorking(e.agentId, e.state === 'working');
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

function mix(a: number, b: number, t: number) {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
