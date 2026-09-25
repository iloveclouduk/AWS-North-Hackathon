// Procedural Habbo-style pixel agents. Kenney has no sitting/typing/fishing character frames, so
// every agent's sheet is painted here from a tiny pixel grid, outlined, then scaled up.
//
// Sheet frame order (see FRAMES): idle ×2, walk ×4, back-idle, back-walk ×4, work ×2 (the agent's
// own activity), type ×2 (sat at a computer), wave.

import type Phaser from 'phaser';
import type { ActivityKind } from '@/world/places';

export const FW = 24; // logical frame width
export const FH = 30; // logical frame height
const OY = 4; // headroom so tall hats fit
export const PX = 3; // screen pixels per logical pixel
export const FEET_Y = 28; // logical y of the ground under the feet

export const FRAMES = {
  idle: [0, 1],
  walk: [2, 3, 4, 5],
  backIdle: [6],
  backWalk: [7, 8, 9, 10],
  work: [11, 12],
  type: [13, 14],
  wave: [15],
} as const;
const FRAME_COUNT = 16;

export interface Look {
  skin: string;
  hair: string;
  hairStyle: 0 | 1 | 2 | 3;
  shirt: string;
  pants: string;
  hat?: 'cap' | 'helmet' | 'chef' | 'wizard' | 'beret';
  hatColor?: string;
  activity: ActivityKind;
}

const SKINS = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'];
const HAIRS = ['#2b1d0e', '#6b4423', '#d4a017', '#b33a3a', '#151515', '#e6e6e6', '#7c3aed'];
const OUTLINE = '#161622';

const HATS: Partial<Record<ActivityKind, Look['hat']>> = {
  cook: 'chef',
  hammer: 'helmet',
  guard: 'helmet',
  think: 'wizard',
  fish: 'cap',
  scan: 'beret',
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

function shade(c: string, f: number) {
  const n = parseInt(c.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
}

export function lookFor(id: string, shirt: number, activity: ActivityKind): Look {
  const h = hash(id);
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >> 4) % HAIRS.length],
    hairStyle: ((h >> 8) % 4) as Look['hairStyle'],
    shirt: hex(shirt),
    pants: ['#2d3250', '#3b3b3b', '#4a3728', '#1f3a5f'][(h >> 12) % 4],
    hat: HATS[activity],
    hatColor: activity === 'think' ? '#4338ca' : activity === 'cook' ? '#ffffff' : shade(hex(shirt), 0.7),
    activity,
  };
}

// ── pixel grid helpers ──

type Grid = (string | null)[][];
const grid = (): Grid => Array.from({ length: FH }, () => Array<string | null>(FW).fill(null));
function rect(g: Grid, x: number, y: number, w: number, h: number, c: string) {
  y += OY;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < FH && i >= 0 && i < FW) g[j][i] = c;
}
const px = (g: Grid, x: number, y: number, c: string) => rect(g, x, y, 1, 1, c);

function outlined(g: Grid): Grid {
  const o = g.map((r) => [...r]);
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      if (g[y][x]) continue;
      const n = [g[y - 1]?.[x], g[y + 1]?.[x], g[y]?.[x - 1], g[y]?.[x + 1]];
      if (n.some(Boolean)) o[y][x] = OUTLINE;
    }
  return o;
}

// ── character ──

type Arm = 'down' | 'up' | 'fwd' | 'fwdLow' | 'chin' | 'hold';
interface Pose {
  bob?: number;
  legs?: 'stand' | 'walkA' | 'walkB' | 'sit';
  armL?: Arm;
  armR?: Arm;
  back?: boolean;
  blink?: boolean;
}

function drawChar(g: Grid, L: Look, p: Pose) {
  const dy = (p.bob ?? 0) + (p.legs === 'sit' ? 3 : 0);
  const skinD = shade(L.skin, 0.85);
  const shirtD = shade(L.shirt, 0.8);
  const shoes = '#1b1b1b';

  // legs
  if (p.legs === 'sit') {
    // stool
    rect(g, 8, 22, 8, 1, '#8b5a2b');
    rect(g, 9, 23, 1, 1, '#6b4423');
    rect(g, 14, 23, 1, 1, '#6b4423');
    rect(g, 9, 18 + 3, 9, 1, L.pants); // thighs forward
    rect(g, 16, 22, 2, 1, L.pants);
    rect(g, 16, 23, 3, 1, shoes);
  } else {
    const lUp = p.legs === 'walkA' ? 1 : 0;
    const rUp = p.legs === 'walkB' ? 1 : 0;
    rect(g, 9, 19 + dy, 2, 4 - lUp - dy, L.pants);
    rect(g, 8 + (lUp ? -1 : 0), 23 - lUp, 3, 1, shoes);
    rect(g, 13, 19 + dy, 2, 4 - rUp - dy, L.pants);
    rect(g, 13 + (rUp ? 1 : 0), 23 - rUp, 3, 1, shoes);
  }

  // body
  rect(g, 8, 11 + dy, 8, 7, L.shirt);
  rect(g, 8, 17 + dy, 8, 1, shirtD);
  rect(g, 8, 18 + dy, 8, 1, L.pants); // belt
  if (!p.back) rect(g, 11, 11 + dy, 2, 1, skinD); // collar

  // arms
  const arm = (side: 'L' | 'R', a: Arm) => {
    const x = side === 'L' ? 7 : 16;
    const dir = side === 'L' ? -1 : 1;
    switch (a) {
      case 'down':
        rect(g, x, 11 + dy, 1, 6, shirtD);
        px(g, x, 17 + dy, L.skin);
        break;
      case 'up':
        rect(g, x, 6 + dy, 1, 5, shirtD);
        px(g, x, 5 + dy, L.skin);
        break;
      case 'fwd':
        rect(g, x, 11 + dy, 1, 3, shirtD);
        rect(g, x + dir, 14 + dy, 3 * dir > 0 ? 3 : 1, 1, shirtD);
        if (dir > 0) px(g, x + 4, 14 + dy, L.skin);
        else px(g, x - 1, 14 + dy, L.skin);
        break;
      case 'fwdLow':
        rect(g, x, 11 + dy, 1, 4, shirtD);
        if (dir > 0) {
          rect(g, x + 1, 15 + dy, 2, 1, shirtD);
          px(g, x + 3, 15 + dy, L.skin);
        } else px(g, x, 15 + dy, L.skin);
        break;
      case 'chin':
        rect(g, x, 11 + dy, 1, 2, shirtD);
        px(g, x - dir, 10 + dy, L.skin);
        break;
      case 'hold':
        rect(g, x, 11 + dy, 1, 3, shirtD);
        px(g, x + dir, 13 + dy, L.skin);
        break;
    }
  };
  arm('L', p.armL ?? 'down');
  arm('R', p.armR ?? 'down');

  // head
  rect(g, 8, 3 + dy, 8, 8, L.skin);
  rect(g, 8, 10 + dy, 8, 1, skinD);
  if (p.back) {
    rect(g, 7, 2 + dy, 10, 8, L.hair);
  } else {
    if (!p.blink) {
      px(g, 10, 7 + dy, '#1a1a1a');
      px(g, 13, 7 + dy, '#1a1a1a');
    } else {
      px(g, 10, 7 + dy, skinD);
      px(g, 13, 7 + dy, skinD);
    }
    px(g, 11, 9 + dy, skinD);
    px(g, 12, 9 + dy, skinD);
    px(g, 8, 8 + dy, '#f4a6a6'); // cheek
    px(g, 15, 8 + dy, '#f4a6a6');
    // hair
    rect(g, 7, 2 + dy, 10, 3, L.hair);
    if (L.hairStyle === 1) rect(g, 7, 5 + dy, 1, 4, L.hair), rect(g, 16, 5 + dy, 1, 4, L.hair);
    if (L.hairStyle === 2) px(g, 9, 1 + dy, L.hair), px(g, 12, 1 + dy, L.hair), px(g, 15, 1 + dy, L.hair);
    if (L.hairStyle === 3) rect(g, 7, 5 + dy, 1, 7, L.hair), rect(g, 16, 5 + dy, 1, 7, L.hair);
  }

  // hat
  const hc = L.hatColor ?? '#333';
  switch (L.hat) {
    case 'cap':
      rect(g, 7, 1 + dy, 10, 2, hc);
      if (!p.back) rect(g, 13, 3 + dy, 5, 1, shade(hc, 0.8));
      break;
    case 'helmet':
      rect(g, 7, 0 + dy, 10, 3, hc);
      rect(g, 6, 3 + dy, 12, 1, shade(hc, 0.8));
      break;
    case 'chef':
      rect(g, 8, -2 + dy, 8, 4, '#ffffff');
      rect(g, 7, -3 + dy, 10, 2, '#ffffff');
      rect(g, 7, 2 + dy, 10, 1, '#e5e5e5');
      break;
    case 'wizard':
      rect(g, 7, 1 + dy, 10, 2, hc);
      rect(g, 9, -1 + dy, 6, 2, hc);
      rect(g, 11, -3 + dy, 2, 2, hc);
      px(g, 11, 0 + dy, '#fde047');
      break;
    case 'beret':
      rect(g, 7, 1 + dy, 9, 2, hc);
      px(g, 11, 0 + dy, hc);
      break;
  }
}

// ── activity props (drawn on top of the character) ──

function drawWork(g: Grid, L: Look, f: 0 | 1) {
  switch (L.activity) {
    case 'fish': {
      drawChar(g, L, { armR: 'hold', armL: 'hold' });
      for (let i = 0; i < 9; i++) px(g, 18 + Math.floor(i / 2), 12 - i, '#8b5a2b'); // rod
      const tipX = 22;
      const bobY = 20 + f;
      for (let y = 4; y < bobY; y++) px(g, tipX, y, '#d1d5db'); // line
      px(g, tipX, bobY, '#ef4444');
      px(g, tipX, bobY + 1, '#ffffff');
      rect(g, 19, 24, 5, 1, '#60a5fa'); // ripple
      if (f) px(g, 20, 23, '#93c5fd');
      break;
    }
    case 'guard':
      drawChar(g, L, { armR: 'fwd', bob: f });
      rect(g, 15, 10 + f, 6, 9, '#cbd5e1');
      rect(g, 16, 11 + f, 4, 7, '#94a3b8');
      rect(g, 17, 12 + f, 2, 5, '#dc2626');
      rect(g, 16, 14 + f, 4, 1, '#dc2626');
      if (f) px(g, 22, 12, '#fde047'), px(g, 23, 11, '#fde047'); // deflected spark
      break;
    case 'dance':
      drawChar(g, L, { armL: f ? 'up' : 'down', armR: f ? 'down' : 'up', bob: f ? 0 : 1, legs: f ? 'walkA' : 'walkB' });
      px(g, f ? 3 : 20, f ? 3 : 1, '#f472b6');
      px(g, f ? 3 : 20, f ? 4 : 2, '#f472b6');
      px(g, f ? 4 : 21, f ? 3 : 1, '#f472b6');
      break;
    case 'cook':
      drawChar(g, L, { armR: 'fwd' });
      rect(g, 18, 15, 5, 1, '#374151'); // pan
      px(g, 17, 14, '#374151');
      rect(g, 19, f ? 10 : 13, 3, 2, '#a16207'); // flipping patty
      if (f) px(g, 20, 8, '#f97316'), px(g, 21, 7, '#fbbf24');
      break;
    case 'file':
      drawChar(g, L, { armR: f ? 'up' : 'fwd' });
      rect(g, 17, 16, 6, 8, '#92400e'); // cabinet
      rect(g, 18, 17, 4, 1, '#fcd34d');
      rect(g, 18, 20, 4, 1, '#fcd34d');
      rect(g, f ? 16 : 19, f ? 4 : 12, 3, 2, '#fef3c7'); // card
      break;
    case 'hammer':
      drawChar(g, L, { armR: f ? 'up' : 'fwdLow' });
      rect(g, 17, 20, 6, 4, '#6b7280'); // anvil/block
      rect(g, 16, 19, 8, 1, '#9ca3af');
      if (f) rect(g, 15, 2, 4, 2, '#4b5563'), px(g, 16, 4, '#8b5a2b');
      else rect(g, 19, 17, 4, 2, '#4b5563'), px(g, 18, 16, '#8b5a2b'), px(g, 23, 18, '#fde047');
      break;
    case 'scan':
      drawChar(g, L, { armR: 'chin', armL: 'chin' });
      rect(g, 9, 6, 6, 4, '#1f2937'); // camera over face
      px(g, 12, 7, '#60a5fa');
      px(g, 13, 7, '#93c5fd');
      if (f) rect(g, 15, 4, 3, 1, '#ffffff'), rect(g, 16, 3, 1, 3, '#ffffff'), px(g, 19, 2, '#ffffff');
      break;
    case 'think':
      drawChar(g, L, { armR: 'chin', blink: !!f });
      px(g, 18, 3, '#e5e7eb');
      if (f) px(g, 20, 1, '#e5e7eb'), px(g, 21, 1, '#e5e7eb'), px(g, 20, 0, '#e5e7eb'), px(g, 21, 0, '#e5e7eb');
      break;
    case 'carry':
      drawChar(g, L, { armL: 'up', armR: 'up', bob: f, legs: f ? 'walkA' : 'walkB' });
      rect(g, 6, -1 + 2 + f, 12, 4, '#b45309');
      rect(g, 6, 1 + 2 + f, 12, 1, '#78350f');
      break;
    case 'check':
      drawChar(g, L, { armR: 'fwd', armL: 'hold' });
      rect(g, 18, 11, 4, 5, '#f8fafc');
      rect(g, 19, 10, 2, 1, '#6b7280');
      px(g, 19, 13, f ? '#16a34a' : '#9ca3af');
      px(g, 20, 14, f ? '#16a34a' : '#9ca3af');
      break;
    case 'lock':
      drawChar(g, L, { armR: 'fwd' });
      if (f) rect(g, 20, 11, 2, 6, '#facc15'), rect(g, 19, 10, 4, 2, '#eab308');
      else rect(g, 17, 14, 6, 2, '#facc15'), rect(g, 22, 13, 2, 4, '#eab308');
      break;
    case 'type':
    default:
      drawType(g, L, f);
  }
}

function drawType(g: Grid, L: Look, f: 0 | 1) {
  drawChar(g, L, { legs: 'sit', armR: 'fwd', armL: 'fwd', bob: 0 });
  // tapping hands
  px(g, 20, 17 + f, L.skin);
  px(g, 19, 17 + (1 - f), L.skin);
}

// ── sheet generation ──

function paint(ctx: CanvasRenderingContext2D, g: Grid, frame: number) {
  const ox = frame * FW * PX;
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const c = g[y][x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * PX, y * PX, PX, PX);
    }
}

function frameGrids(L: Look): Grid[] {
  const f = (fn: (g: Grid) => void) => {
    const g = grid();
    fn(g);
    return outlined(g);
  };
  return [
    f((g) => drawChar(g, L, {})),
    f((g) => drawChar(g, L, { bob: 1, blink: true })),
    f((g) => drawChar(g, L, { legs: 'walkA', armL: 'down', armR: 'down' })),
    f((g) => drawChar(g, L, { bob: 1 })),
    f((g) => drawChar(g, L, { legs: 'walkB' })),
    f((g) => drawChar(g, L, { bob: 1 })),
    f((g) => drawChar(g, L, { back: true })),
    f((g) => drawChar(g, L, { back: true, legs: 'walkA' })),
    f((g) => drawChar(g, L, { back: true, bob: 1 })),
    f((g) => drawChar(g, L, { back: true, legs: 'walkB' })),
    f((g) => drawChar(g, L, { back: true, bob: 1 })),
    f((g) => drawWork(g, L, 0)),
    f((g) => drawWork(g, L, 1)),
    f((g) => drawType(g, L, 0)),
    f((g) => drawType(g, L, 1)),
    f((g) => drawChar(g, L, { armL: 'up', armR: 'up' })),
  ];
}

/** Registers `agent:<key>` spritesheet + animations `<key>:idle|walk|backIdle|backWalk|work|type|wave`. */
export function registerAgentSheet(scene: Phaser.Scene, key: string, look: Look) {
  const tex = `agent:${key}`;
  if (scene.textures.exists(tex)) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = FW * PX * FRAME_COUNT;
  canvas.height = FH * PX;
  const ctx = canvas.getContext('2d')!;
  frameGrids(look).forEach((g, i) => paint(ctx, g, i));
  scene.textures.addSpriteSheet(tex, canvas as unknown as HTMLImageElement, { frameWidth: FW * PX, frameHeight: FH * PX });

  const anim = (name: keyof typeof FRAMES, frameRate: number) =>
    scene.anims.create({
      key: `${key}:${name}`,
      frames: FRAMES[name].map((frame) => ({ key: tex, frame })),
      frameRate,
      repeat: -1,
    });
  anim('idle', 1.5);
  anim('walk', 8);
  anim('backIdle', 1);
  anim('backWalk', 8);
  anim('work', look.activity === 'dance' ? 4 : 3);
  anim('type', 6);
  anim('wave', 1);
  return tex;
}
