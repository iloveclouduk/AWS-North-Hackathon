// The AWS City title scene for the terminal: block-letter "AWS CITY" over a night skyline of AWS landmarks (in the
// game's district colours), with a monorail, a bay and its bridge, and a two-lane road where Lambda, S3 and EC2 drive by.
// The city grows: `growth` (0..1) raises it lot by lot from the centre out, so `npm start` builds it while it works.
// `frame(t, width)` is pure (same t ⇒ same picture) so it's unit-tested; `playIntro()` animates it.

// ── colour ───────────────────────────────────────────────────────────────────
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? '');
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const to256 = ([r, g, b]) => 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);
const fgCode = (c) => (TRUECOLOR ? `38;2;${hex(c).join(';')}` : `38;5;${to256(hex(c))}`);
const bgCode = (c) => (TRUECOLOR ? `48;2;${hex(c).join(';')}` : `48;5;${to256(hex(c))}`);
/** Colours a string with a hex colour (and optional bold), for the dashboard. */
export const paint = (s, color, { bold = false, bg } = {}) =>
  `\x1b[${[bold ? '1' : '', color ? fgCode(color) : '', bg ? bgCode(bg) : ''].filter(Boolean).join(';')}m${s}\x1b[0m`;
export { C as COLORS };
const mix = (a, b, k) => `#${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;

// The game's district colours (shared/world.json) and the night city's tones.
const C = {
  orange: '#FF9900', amber: '#FFC34D', shadow: '#9A5C00', compute: '#ED7100', storage: '#7AA116', database: '#C925D1',
  networking: '#8C4FFF', security: '#DD344C', ai: '#01A88D', window: '#FFE38A', windowCool: '#CFF3FF', windowOff: '#2A2F45',
  star: '#C9D4FF', road: '#3A3F55', line: '#E8E8E8', kerb: '#8A90A8', beacon: '#FF3B3B', text: '#FFFFFF', dim: '#7F8AA8',
  ink: '#111111', skyTop: '#060918', skyLow: '#2B2150', moon: '#F4EFCF', cloud: '#2C3358', sidewalk: '#2A2E42',
  tree: '#3FA34D', trunk: '#7A5230', lamp: '#FFE7A0', pole: '#69718C', rail: '#A7B0C8', train: '#E9EEF6', trainWin: '#8FD8FF',
  water: '#0E2A4A', waterHi: '#4C9BD6', bridge: '#E4572E', cable: '#F08A5D', crane: '#F5B700', steel: '#6B7280',
};

// ── lettering ────────────────────────────────────────────────────────────────
const BIG = {
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  W: ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  Y: ['██╗   ██╗', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚██╔╝  ', '   ██║   ', '   ╚═╝   '],
  ' ': ['   ', '   ', '   ', '   ', '   ', '   '],
};
const SMALL = { A: ['▄▀█', '█▀█'], W: ['█ █ █', '▀▄▀▄▀'], S: ['█▀', '▄█'], C: ['█▀▀', '█▄▄'], I: ['█', '█'], T: ['▀█▀', ' █ '], Y: ['█▄█', ' █ '], ' ': ['  ', '  '] };
const word = (font, text) => font.A.map((_, r) => [...text].map((ch) => font[ch][r]).join(' '));

// ── helpers ──────────────────────────────────────────────────────────────────
/** Deterministic 0..1 noise, so frames repeat exactly. */
const noise = (a, b = 0) => {
  let h = Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 1442695041, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mod = (a, n) => ((a % n) + n) % n;

/** A grid of cells {ch, fg, bg, bold}; rendered to strings at the end. `bg(row)` paints the backdrop. */
const grid = (w, h, bg = () => undefined) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, () => ({ ch: ' ', bg: bg(y) })));
/** Draws one cell, clipped to the grid. A cell without its own background keeps the one behind it (the sky). */
const put = (g, x, y, ch, style = {}) => {
  if (y < 0 || y >= g.length || x < 0 || x >= g[0].length) return;
  g[y][x] = { ...style, ch, bg: style.bg ?? g[y][x].bg };
};
const text = (g, x, y, s, style) => [...s].forEach((ch, i) => put(g, x + i, y, ch, style));

// ── the city ─────────────────────────────────────────────────────────────────
// Every finished building tops out with exactly one of these glyphs (and nothing else in the scene uses them), so a
// test can count roofs: a complete city shows one per lot.
export const ROOF_TIPS = '╻╹╿◆▲';
const SKY_H = 9; // stars + roofs + tallest building
const SKY_H_COMPACT = 6;
const BAY_W = 26; // the bay and its bridge, at the right of wide scenes
const BAY_FROM = 99; // scene columns (a 100-column terminal)
const RAIL_FROM = 59; // the monorail needs a 60-column terminal
const RAIL_AT = 0.5; // growth when the monorail opens
const BRIDGE_AT = 0.8; // …and the bridge

// Lots: [style, width, floors, colour, label]. The Spheres stand in the middle; the rest spread out from them.
const CENTRE = ['spheres', 11, 4, C.ai, ''];
const RIGHT = [
  ['glass', 7, 7, C.database, 'RDS'],
  ['mast', 5, 5, C.security, 'IAM'],
  ['warehouse', 8, 3, C.storage, 'S3'],
  ['deco', 7, 6, C.compute, 'ECS'],
  ['needle', 5, 6, C.networking, ''],
  ['glass', 5, 5, C.database, 'DDB'],
  ['mast', 5, 4, C.orange, 'λ'],
  ['glass', 6, 6, C.security, 'KMS'],
];
const LEFT = [
  ['pyramid', 9, 4, C.ai, 'AI'],
  ['deco', 7, 7, C.compute, 'EC2'],
  ['needle', 5, 7, C.networking, ''],
  ['glass', 6, 6, C.networking, 'VPC'],
  ['warehouse', 7, 3, C.storage, 'EBS'],
  ['mast', 5, 5, C.orange, 'SQS'],
  ['glass', 5, 6, C.compute, ''],
  ['deco', 7, 5, C.database, ''],
];
// Rows above the top floor each roof needs, in the full and the compact scene.
const ROOF_H = { glass: [2, 1], deco: [2, 1], needle: [2, 2], mast: [2, 2], pyramid: [1, 1], spheres: [1, 1], warehouse: [2, 2] };

/**
 * Where the lots go for a scene `width` columns wide: centre-out from the Spheres, then each lot's place in the
 * build order (`k`: centre-out, jittered by noise). Pure; exported for tests.
 */
export function lotsFor(width, { compact = width < 84 } = {}) {
  const W = sceneWidth(width);
  const skyH = compact ? SKY_H_COMPACT : SKY_H;
  const bay = W >= BAY_FROM;
  const end = bay ? W - BAY_W : W;
  const avail = Math.max(0, end - 2);
  const gapOf = (def) => 1 + (noise(def[1] * 7 + def[2], def[0].length) < 0.5 ? 1 : 0);
  // Alternate right and left from the centre; a side that runs out of room stops growing.
  const queue = [[CENTRE, 0]];
  for (let n = 0; n < Math.max(RIGHT.length, LEFT.length); n++) queue.push([RIGHT[n], 1], [LEFT[n], -1]);
  const row = [];
  let used = 0;
  const closed = new Set();
  for (const [def, side] of queue) {
    if (!def || closed.has(side)) continue;
    const need = def[1] + (row.length ? gapOf(def) : 0);
    if (used + need > avail) {
      if (side) closed.add(side);
      continue;
    }
    used += need;
    if (side < 0) row.unshift(def);
    else row.push(def);
  }
  let x = 1 + Math.floor((avail - used) / 2);
  const lots = row.map((def, n) => {
    if (n) x += gapOf(def);
    const [style, w, floors, col, label] = def;
    const R = ROOF_H[style][compact ? 1 : 0];
    const h = Math.max(2, Math.min(compact ? floors - 3 : floors, skyH - R));
    const lot = { style, x, w, h, R, col, label, id: LEFT.indexOf(def) >= 0 ? 100 + LEFT.indexOf(def) : RIGHT.indexOf(def) + 1 };
    x += w;
    return lot;
  });
  // Build order: nearest the middle first, with a little noise so it doesn't look mechanical.
  const mid = (1 + end) / 2;
  const key = (l) => Math.abs(l.x + l.w / 2 - mid) / Math.max(1, avail) + noise(l.id, 11) * 0.18;
  [...lots].sort((a, b) => key(a) - key(b)).forEach((l, k) => (l.k = k));
  return lots;
}
const sceneWidth = (width) => Math.max(1, Math.min(width, 110) - 1);

/** Timeline (seconds): the city grows 0–1.6, letters wipe 0.6–1.3, traffic always moving, fireworks once it's built. */
export const INTRO_SECONDS = 2.6;
/** The intro's growth at time t (an ease-out, so the last towers settle rather than snap). */
export const introGrowth = (t) => 1 - (1 - clamp01(t / 1.6)) ** 2;

/**
 * One frame of the scene at time `t` for a terminal `width` columns wide.
 * `growth` (0..1) is how much of the city is built; `pending` cranes stand on the lots being built.
 * Returns lines (ANSI-coloured when `color`); every line is at most `width` visible columns.
 */
export function frame(t, width, { color = true, compact: forceCompact, pending = 0, tagline: withTagline = true, growth = 1 } = {}) {
  const compact = forceCompact ?? width < 84;
  const W = sceneWidth(width);
  growth = clamp01(growth);
  const rows = [];

  // Title: wipes in left → right, orange → amber across, the box-drawing "shadow" darker.
  const title = compact ? word(SMALL, 'AWS CITY') : word(BIG, 'AWS CITY');
  const titleW = title[0].length;
  const wipe = clamp01((t - 0.6) / 0.7);
  const tg = grid(W, title.length);
  const tx = Math.max(0, Math.floor((W - titleW) / 2));
  title.forEach((line, r) =>
    [...line].forEach((ch, c) => {
      if (ch === ' ' || c / titleW > wipe) return;
      const shade = '╗║╝═╔╚'.includes(ch);
      // Once written, a soft light band keeps sweeping across the letters.
      const band = ((t - 1.3) * 26) % (titleW + 40) - 12;
      const glow = t > 1.3 ? Math.max(0, 1 - Math.abs(c - band) / 5) : 0;
      const base = mix(C.orange, C.amber, c / titleW);
      put(tg, tx + c, r, ch, { fg: shade ? C.shadow : glow ? mix(base, '#FFF6E0', glow * 0.85) : base, bold: !shade });
    }),
  );
  rows.push(tg);

  const skyH = compact ? SKY_H_COMPACT : SKY_H;
  const G = skyH - 1; // the ground floor's row
  const skyBg = (y) => mix(C.skyTop, C.skyLow, (y / (skyH - 1)) ** 1.4);
  const sky = grid(W, skyH, skyBg);
  const lots = lotsFor(width, { compact });
  const n = Math.max(1, lots.length);
  const localOf = (lot) => clamp01(growth * n - lot.k);
  const bay = W >= BAY_FROM;
  const end = bay ? W - BAY_W : W;
  const done = growth >= 1 && pending === 0;

  drawSkyBackdrop(sky, W, skyH, t, compact);
  if (done) drawFireworks(sky, end, compact ? 2 : 3, t);
  if (bay) drawBay(sky, end, W, G, skyH, t, growth, compact);
  // The lots, with trees, lamps and monorail pillars in the gaps between them.
  const rail = !compact && W >= RAIL_FROM && growth >= RAIL_AT;
  const pillars = [];
  lots.forEach((lot, j) => {
    drawLot(sky, lot, G, localOf(lot), t, color);
    const next = lots[j + 1];
    if (!next) return;
    const gx = lot.x + lot.w;
    const grown = Math.min(localOf(lot), localOf(next));
    const kind = (lot.id + j) % 3;
    if (rail && kind === 0) pillars.push(gx);
    else if (grown >= 0.6) (kind === 1 ? drawLamp : drawTree)(sky, next.x - gx > 1 ? gx + (lot.id % 2) : gx, G, compact);
  });
  // The margins outside the lots get a row of trees and lamps as the city reaches them.
  if (lots.length) {
    const reach = growth >= 0.95;
    for (let x = 1; reach && x < lots[0].x - 1; x += 3) (x % 2 ? drawTree : drawLamp)(sky, x, G, compact);
    for (let x = lots.at(-1).x + lots.at(-1).w + 1; reach && x < end - 1; x += 3) (x % 2 ? drawLamp : drawTree)(sky, x, G, compact);
  }
  if (rail) drawMonorail(sky, end, G - 2, G, pillars, t);
  // Cranes go on the lots being built, earliest first; with more steps than open lots, beside finished ones.
  const building = [...lots].sort((a, b) => a.k - b.k);
  const cranes = [...building.filter((l) => localOf(l) < 1), ...building.filter((l) => localOf(l) >= 1).reverse()].slice(0, pending);
  for (const lot of cranes) drawCrane(sky, lot, G, localOf(lot), t);
  rows.push(sky);

  rows.push(compact ? roadCompact(W, t, lots) : road(W, t, lots));

  // Tagline under the road, centred.
  if (!withTagline) return rows.flat().map((line) => render(line, color));
  const tag = grid(W, 1);
  const long = 'learn AWS by living in it  ·  every service is a place, every agent does its real job';
  const tagline = !compact && long.length <= W ? long : 'learn AWS by living in it';
  if (t > 1.0) text(tag, Math.max(0, Math.floor((W - tagline.length) / 2)), 0, tagline, { fg: C.dim });
  rows.push(tag);

  return rows.flat().map((line) => render(line, color));
}

// ── sky ──────────────────────────────────────────────────────────────────────
function drawSkyBackdrop(g, W, skyH, t, compact) {
  const starRows = compact ? 2 : 4;
  for (let x = 0; x < W; x++) {
    if (noise(x, 7) >= 0.07) continue;
    const y = Math.floor(noise(x, 9) * starRows);
    const twinkle = noise(x, Math.floor(t * 2.5) + 17);
    put(g, x, y, twinkle < 0.2 ? '·' : noise(x, 5) < 0.35 ? '✦' : '⋅', { fg: mix(C.star, C.skyTop, y / (starRows + 2) + (twinkle < 0.2 ? 0.4 : 0)) });
  }
  // The moon (with a soft halo), up and to the left, behind everything.
  const mx = Math.max(2, Math.floor(W * 0.1));
  if (W >= 30) {
    for (let y = 0; y <= 2; y++) for (let x = mx - 2; x <= mx + 5; x++) if (g[y]?.[x]) g[y][x] = { ...g[y][x], bg: mix(g[y][x].bg ?? C.skyTop, C.moon, y === 2 ? 0.05 : 0.1) };
    text(g, mx, 0, '▗██▖', { fg: C.moon });
    text(g, mx, 1, '▝██▘', { fg: C.moon });
    put(g, mx + 2, 1, '█', { fg: mix(C.moon, '#9C977C', 0.45) });
  }
  // One slow cloud drifting across.
  const cx = Math.floor((8 + t * 1.6) % (W + 12)) - 8;
  text(g, cx, compact ? 1 : 2, '▂▄▆▆▄▃▂', { fg: C.cloud });
}

function drawFireworks(g, end, rows, t) {
  const hues = [C.orange, C.ai, C.database, C.amber, C.networking];
  for (let k = 0; k < 3; k++) {
    const period = 1.7;
    const cycle = Math.floor((t + k * 0.57) / period);
    const p = ((t + k * 0.57) % period) / period;
    const x = 4 + Math.floor(noise(k * 13 + cycle, 41) * Math.max(1, end - 8));
    const y = Math.min(rows - 1, 1 + Math.floor(noise(cycle, k + 3) * rows));
    const col = hues[(cycle + k) % hues.length];
    if (p < 0.18) {
      put(g, x, y + 2, '╵', { fg: C.amber });
      continue;
    }
    if (p > 0.85) continue;
    const r = Math.min(3, 1 + Math.floor((p - 0.18) * 6));
    const fade = clamp01((p - 0.5) / 0.35);
    const fg = mix(col, C.skyTop, fade * 0.6);
    put(g, x, y, '✶', { fg: mix('#FFFFFF', col, fade), bold: true });
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) put(g, x + dx * r * (dy ? 1 : 1), y + dy * Math.min(r, 1), r > 2 ? '·' : dy && dx ? '⋅' : '•', { fg });
  }
}

// ── buildings ────────────────────────────────────────────────────────────────
/**
 * One lot at `local` (0..1) of its build: foundations, then floors rising, then the lights, then the roof at 1.
 * Windows only sit on odd floors and labels on the ground floor, so decor (the monorail runs at floor 2) never
 * covers one and a window, once lit, stays lit as the city grows.
 */
function drawLot(g, lot, G, local, t, color) {
  if (local < 0.05) {
    for (let c = 0; c < lot.w; c += 2) put(g, lot.x + c, G, '▁', { fg: C.steel });
    return;
  }
  const shown = Math.max(1, Math.round(lot.h * clamp01((local - 0.05) / 0.6)));
  const lights = clamp01((local - 0.7) / 0.28);
  const wall = mix(lot.col, '#000000', 0.55);
  const ctx = { ...lot, g, G, shown, lights, roof: local >= 1, t, color, wall };
  STYLES[lot.style](ctx);
  // The sign over the door, once the building opens; only where it fits between the walls.
  const n = [...lot.label].length;
  if (local >= 1 && lot.label && n <= lot.w - 2) text(g, lot.x + Math.floor((lot.w - n) / 2), G, lot.label, { fg: C.text, bg: mix(lot.col, '#000000', 0.25), bold: true });
}

/** A window on floor r: lit ones come on as the lights do (and a few blink off over time). */
function win(ctx, c, r, bg) {
  const seed = ctx.id * 37 + c;
  const on = noise(seed, r * 3 + 1) < ctx.lights * 0.93 && noise(seed, r * 7 + Math.floor(ctx.t * 1.5) * 13) >= 0.06;
  const cool = noise(seed, r + 50) < 0.3;
  put(ctx.g, ctx.x + c, ctx.G - r, on || ctx.color ? '▪' : '·', { fg: on ? (cool ? C.windowCool : C.window) : C.windowOff, bg });
}
/** The lobby: a warm glow once the lights are on. */
const lobby = (ctx, c, bg) => put(ctx.g, ctx.x + c, ctx.G, ' ', { bg: ctx.lights > 0.3 ? mix(bg, C.window, 0.3) : bg });

const STYLES = {
  /** Glass tower: a grid of panes between mullions, a crown and a lightning rod. */
  glass(ctx) {
    const { g, x, w, G, shown, col } = ctx;
    const glassBg = mix(col, '#050A14', 0.7);
    const frameFg = mix(col, '#FFFFFF', 0.35);
    for (let r = 0; r < shown; r++) {
      const y = G - r;
      put(g, x, y, '▐', { fg: col });
      put(g, x + w - 1, y, '▌', { fg: col });
      for (let c = 1; c < w - 1; c++) {
        const mullion = c % 2 === 0;
        if (r === 0) lobby(ctx, c, glassBg);
        else if (r % 2) mullion ? put(g, x + c, y, '│', { fg: frameFg, bg: glassBg }) : win(ctx, c, r, glassBg);
        else put(g, x + c, y, mullion ? '┼' : '─', { fg: mix(frameFg, glassBg, 0.35), bg: glassBg });
      }
    }
    if (!ctx.roof) return;
    const top = G - ctx.h + 1;
    const mid = x + Math.floor(w / 2);
    if (ctx.R > 1) {
      text(g, x + 1, top - 1, '▄'.repeat(w - 2), { fg: col });
      put(g, mid, top - 2, '╻', { fg: C.kerb });
    } else put(g, mid, top - 1, '╻', { fg: C.kerb });
  },

  /** Art-deco tower: setbacks with ▟▙ shoulders, piers between the windows, a spire. */
  deco(ctx) {
    const { g, x, w, h, G, shown, col, wall } = ctx;
    const s1 = Math.ceil(h * 0.5);
    const s2 = w > 5 ? Math.ceil(h * 0.8) : h;
    const pier = mix(col, '#FFFFFF', 0.15);
    for (let r = 0; r < shown; r++) {
      const y = G - r;
      const inset = r >= s2 ? 2 : r >= s1 ? 1 : 0;
      if (r === s1 || (r === s2 && s2 < h)) {
        put(g, x + inset - 1, y, '▟', { fg: col });
        put(g, x + w - inset, y, '▙', { fg: col });
      }
      for (let c = inset; c < w - inset; c++) {
        const edge = c === inset || c === w - 1 - inset;
        if (edge) put(g, x + c, y, '█', { fg: col });
        else if (r === 0) lobby(ctx, c, wall);
        else if (r % 2 && (c - inset) % 2 === 1) win(ctx, c, r, wall);
        else put(g, x + c, y, r % 2 ? '┃' : '▀', { fg: r % 2 ? pier : mix(col, wall, 0.4), bg: wall });
      }
    }
    if (!ctx.roof) return;
    const top = G - h + 1;
    const mid = x + Math.floor(w / 2);
    if (ctx.R > 1) put(g, mid, top - 1, '┃', { fg: C.amber });
    put(g, mid, top - ctx.R, '╿', { fg: C.amber });
  },

  /** Needle: a slim shaft on splayed legs, with an observation pod and a mast on top. */
  needle(ctx) {
    const { g, x, w, G, shown, col } = ctx;
    const mid = x + Math.floor(w / 2);
    for (let r = 0; r < shown; r++) {
      if (r === 0) text(g, mid - 1, G, '◢█◣', { fg: col });
      else put(g, mid, G - r, r % 3 === 2 ? '╋' : '┃', { fg: mix(col, '#FFFFFF', 0.3) });
    }
    if (!ctx.roof) return;
    const top = G - ctx.h + 1;
    // The pod: a saucer with a ring of lit windows (on the roof row, so they come with the roof).
    put(g, mid - 2, top - 1, '◥', { fg: col });
    put(g, mid + 2, top - 1, '◤', { fg: col });
    for (let c = -1; c <= 1; c++) put(g, mid + c, top - 1, ctx.color || ctx.lights ? '▪' : '·', { fg: C.window, bg: mix(col, '#000000', 0.4) });
    put(g, mid, top - 2, '╹', { fg: C.kerb });
  },

  /** Antenna mast: a block with a radio mast and a blinking red beacon. */
  mast(ctx) {
    const { g, x, w, G, shown, col, wall } = ctx;
    for (let r = 0; r < shown; r++) {
      for (let c = 0; c < w; c++) {
        const edge = c === 0 || c === w - 1;
        if (edge) put(g, x + c, G - r, '█', { fg: col });
        else if (r === 0) lobby(ctx, c, wall);
        else if (r % 2) win(ctx, c, r, wall);
        else put(g, x + c, G - r, '▄', { fg: mix(col, wall, 0.55), bg: wall });
      }
    }
    if (!ctx.roof) return;
    const top = G - ctx.h + 1;
    const mid = x + Math.floor(w / 2);
    put(g, mid, top - 1, '╫', { fg: C.kerb });
    put(g, mid, top - 2, '◆', { fg: Math.floor(ctx.t * 2.5) % 2 ? C.beacon : '#6A1A1A', bold: true });
  },

  /** The AI pyramid: stepped glass terraces, lit from inside, with a beacon at the apex. */
  pyramid(ctx) {
    const { g, x, w, G, shown, col } = ctx;
    const glassBg = mix(col, '#03140F', 0.6);
    for (let r = 0; r < shown; r++) {
      const a = r;
      const b = w - 1 - r;
      if (a > b) break;
      put(g, x + a, G - r, '▟', { fg: col });
      put(g, x + b, G - r, '▙', { fg: col });
      for (let c = a + 1; c < b; c++) {
        if (r === 0) lobby(ctx, c, glassBg);
        else if (r % 2) win(ctx, c, r, glassBg);
        else put(g, x + c, G - r, '▔', { fg: mix(col, '#FFFFFF', 0.4), bg: glassBg });
      }
    }
    if (!ctx.roof) return;
    put(g, x + Math.floor(w / 2), G - ctx.h, '▲', { fg: mix(col, '#FFFFFF', 0.5), bold: true });
  },

  /** The Spheres: three overlapping glass domes with a steel lattice and gardens glowing inside. */
  spheres(ctx) {
    const { g, x, w, h, G, shown, col } = ctx;
    const domes = [
      [w / 2, w * 0.36, h],
      [w * 0.2, w * 0.24, h * 0.72],
      [w * 0.8, w * 0.24, h * 0.72],
    ];
    const inside = (c, r) => domes.some(([cx, rx, hh]) => ((c + 0.5 - cx) / rx) ** 2 + ((r + 0.5) / hh) ** 2 <= 1);
    const glassBg = mix(col, '#021512', 0.62);
    const lattice = mix(col, '#FFFFFF', 0.45);
    for (let r = 0; r < shown; r++) {
      for (let c = 0; c < w; c++) {
        if (!inside(c, r)) continue;
        const y = G - r;
        const top = !inside(c, r + 1);
        if (top && !inside(c - 1, r)) put(g, x + c, y, '◢', { fg: col });
        else if (top && !inside(c + 1, r)) put(g, x + c, y, '◣', { fg: col });
        else if (top) put(g, x + c, y, '▄', { fg: col });
        else if (r === 0 && ctx.lights > 0.3 && noise(ctx.id + c, 3) < 0.5) put(g, x + c, y, '♣', { fg: C.tree, bg: mix(glassBg, C.ai, 0.35) });
        else put(g, x + c, y, (c + r) % 2 ? '╳' : '┼', { fg: ctx.lights > 0.5 ? lattice : mix(lattice, glassBg, 0.5), bg: ctx.lights > 0.5 ? mix(glassBg, C.ai, 0.25) : glassBg });
      }
    }
    if (ctx.roof) put(g, x + Math.floor(w / 2), G - h, '╻', { fg: lattice });
  },

  /** Warehouse: loading doors, a strip of windows and a sawtooth roof with a chimney. */
  warehouse(ctx) {
    const { g, x, w, G, shown, col, wall } = ctx;
    for (let r = 0; r < shown; r++) {
      for (let c = 0; c < w; c++) {
        const edge = c === 0 || c === w - 1;
        if (edge) put(g, x + c, G - r, '█', { fg: col });
        else if (r === 0) put(g, x + c, G, c % 3 === 0 ? '▐' : '▤', { fg: mix(col, '#BBBBBB', 0.5), bg: wall });
        else if (r % 2) win(ctx, c, r, wall);
        else put(g, x + c, G - r, '▓', { fg: mix(col, wall, 0.6) });
      }
    }
    if (!ctx.roof) return;
    const top = G - ctx.h + 1;
    for (let c = 0; c < w; c++) put(g, x + c, top - 1, c % 2 ? '◣' : '◢', { fg: c % 2 ? mix(col, C.windowCool, 0.5) : col });
    put(g, x + w - 2, top - 2, '╹', { fg: C.kerb });
  },
};

// ── decor ────────────────────────────────────────────────────────────────────
function drawTree(g, x, G, compact) {
  put(g, x, G, '╽', { fg: C.trunk });
  put(g, x, G - 1, '♣', { fg: C.tree });
  if (!compact) put(g, x, G - 1, '♣', { fg: mix(C.tree, '#000000', 0.15) });
}
function drawLamp(g, x, G) {
  put(g, x, G, '│', { fg: C.pole });
  put(g, x, G - 1, '●', { fg: C.lamp, bold: true });
  for (const dx of [-1, 1]) if (g[G - 1]?.[x + dx]) g[G - 1][x + dx] = { ...g[G - 1][x + dx], bg: mix(g[G - 1][x + dx].bg ?? C.skyLow, C.lamp, 0.18) };
}

/** The monorail: a track at floor 2, pillars in the gaps, and a train gliding along it. */
function drawMonorail(g, end, y, G, pillars, t) {
  for (let x = 0; x < end; x++) put(g, x, y, '═', { fg: C.rail });
  for (const px of pillars) for (let yy = y + 1; yy <= G; yy++) put(g, px, yy, '║', { fg: C.steel });
  const body = '◢▄█▄▄█▄▄█▄◣';
  const len = [...body].length;
  const head = Math.floor((t * 9) % (end + len)) - len;
  [...body].forEach((ch, i) => put(g, head + i, y, ch, { fg: C.train, bg: ch === '▄' ? C.trainWin : undefined }));
}

/** The bay at the right: water with moonlight glints, and a suspension bridge once the city is far enough along. */
function drawBay(g, x0, W, G, skyH, t, growth, compact) {
  for (let x = x0; x < W; x++) {
    const glint = noise(x, Math.floor(t * 3)) < 0.14;
    put(g, x, G, glint ? '~' : '≈', { fg: glint ? '#DDEEFF' : C.waterHi, bg: C.water });
  }
  put(g, x0, G, '▟', { fg: C.kerb });
  if (growth < BRIDGE_AT) return;
  const deck = G - 1;
  const towerTop = compact ? 1 : 2;
  const t1 = x0 + 5;
  const t2 = x0 + BAY_W - 7;
  // Main cable: a parabola between the towers, half spans out to the shores; suspenders hang to the deck.
  const cable = (x) => {
    if (x < t1) return towerTop + ((t1 - x) / 5) * (deck - 1 - towerTop) * 0.9;
    if (x > t2) return towerTop + ((x - t2) / 6) * (deck - 1 - towerTop) * 0.9;
    const m = (t1 + t2) / 2;
    return towerTop + (deck - 1 - towerTop) * (1 - ((x - m) / ((t2 - t1) / 2)) ** 2);
  };
  for (let x = x0; x < W; x++) {
    put(g, x, deck, '▀', { fg: '#8A90A8' });
    if (x === t1 || x === t2) continue;
    const y = Math.round(cable(x));
    const slope = cable(x + 0.5) - cable(x - 0.5);
    put(g, x, y, slope > 0.45 ? '╲' : slope < -0.45 ? '╱' : '─', { fg: C.cable });
    if (x % 2 === 0) for (let yy = y + 1; yy < deck; yy++) put(g, x, yy, '╎', { fg: mix(C.cable, C.skyLow, 0.5) });
  }
  for (const tx of [t1, t2]) {
    for (let y = towerTop; y < G; y++) put(g, tx, y, y === towerTop ? '▄' : y === deck ? '╬' : '█', { fg: C.bridge });
    put(g, tx, G, '▀', { fg: C.bridge, bg: C.water });
  }
}

/** A lot under construction: a crane whose hook travels along the jib, scaffolding on the floor going up. */
function drawCrane(g, lot, G, local, t) {
  const { x, w, h, k } = lot;
  const top = Math.max(1, G - h + 1);
  const jib = Math.max(0, top - 2);
  for (let y = jib + 1; y <= G; y++) put(g, x, y, '┃', { fg: C.crane });
  put(g, x, jib, '┏', { fg: C.crane });
  for (let c = 1; c < w + 1; c++) put(g, x + c, jib, c === w ? '╸' : '━', { fg: C.crane });
  put(g, x - 1, jib, '╺', { fg: C.crane });
  const shown = local < 0.05 ? 0 : Math.round(h * clamp01((local - 0.05) / 0.6));
  const hookX = x + 1 + Math.floor((t * 1.5 + k) % Math.max(1, w - 1));
  const hookY = Math.max(jib + 1, G - shown - 1);
  for (let y = jib + 1; y < hookY; y++) put(g, hookX, y, '│', { fg: C.kerb });
  put(g, hookX, hookY, '╽', { fg: C.kerb });
  if (shown > 0 && shown < h) for (let c = 1; c < w; c += 2) put(g, x + c, G - shown + 1, '╳', { fg: C.steel });
}

// ── the road ─────────────────────────────────────────────────────────────────
// Two-row cars: [label, body colour, text colour, lane (0 = to the right, 1 = to the left), speed (cells/s), start]
const CARS = [
  [' λ ', C.orange, C.ink, 0, 24, 0],
  [' S3 ', C.storage, C.ink, 0, 17, 46],
  [' EC2 ', C.compute, C.ink, 1, 21, 10],
  [' VPC ', C.networking, C.text, 1, 14, 60],
  [' Bedrock ', C.ai, C.ink, 0, 12, 80],
];
const zebraAt = (W, lots) => {
  const spheres = lots.find((l) => l.style === 'spheres');
  return spheres ? spheres.x + Math.floor(spheres.w / 2) - 2 : Math.floor(W / 2) - 2;
};

/** Sidewalk, lane →, centre line, lane ← (its edge line scrolling the other way), a zebra crossing, two-row cars. */
function road(W, t, lots) {
  const g = grid(W, 6, (y) => (y === 0 ? C.sidewalk : C.road));
  const shift = Math.floor(t * 12);
  for (let c = 0; c < W; c++) {
    put(g, c, 0, '▁', { fg: C.kerb });
    put(g, c, 3, mod(c + shift, 6) < 3 ? '─' : ' ', { fg: C.line });
    put(g, c, 5, mod(c - shift, 8) < 3 ? '▁' : ' ', { fg: mix(C.line, C.road, 0.4) });
  }
  const zx = zebraAt(W, lots);
  for (let y = 1; y <= 5; y++) text(g, zx, y, '▄▄▄▄', { fg: C.line });
  for (const [label, body, ink, lane, speed, start] of CARS) {
    const n = [...label].length;
    const len = n + 5; // ▗▅ label ▅▖ + headlight
    const pos = Math.floor((start + speed * t) % (W + len));
    const right = lane === 0;
    const cx = right ? pos - len : W - pos;
    const y = right ? 1 : 4;
    const bx = right ? cx : cx + 1; // body start (the headlight leads)
    put(g, bx, y, '▗', { fg: body });
    put(g, bx + 1, y, '▅', { fg: body });
    text(g, bx + 2, y, label, { fg: ink, bg: body, bold: true });
    put(g, bx + 2 + n, y, '▅', { fg: body });
    put(g, bx + 3 + n, y, '▖', { fg: body });
    text(g, bx, y + 1, `▝●${'▀'.repeat(n)}●▘`, { fg: body });
    for (const wx of [bx + 1, bx + 2 + n]) put(g, wx, y + 1, '●', { fg: '#C9CEDB' });
    if (right) put(g, bx + 4 + n, y, '▶', { fg: C.window });
    else put(g, cx, y, '◀', { fg: C.window });
  }
  return g;
}

/** The compact road: sidewalk, one-row label cars, a centre line and an edge line scrolling opposite ways. */
function roadCompact(W, t, lots) {
  const g = grid(W, 5, (y) => (y === 0 || y === 4 ? undefined : C.road));
  const shift = Math.floor(t * 12);
  for (let c = 0; c < W; c++) {
    put(g, c, 0, '▁', { fg: C.kerb });
    put(g, c, 2, mod(c + shift, 6) < 3 ? '─' : ' ', { fg: C.line });
    put(g, c, 4, mod(c - shift, 6) < 4 ? '▔' : ' ', { fg: C.kerb });
  }
  const zx = zebraAt(W, lots);
  for (let y = 1; y <= 3; y++) text(g, zx, y, '▄▄▄▄', { fg: C.line });
  for (const [label, body, ink, lane, speed, start] of CARS) {
    const len = [...label].length + 1;
    const pos = Math.floor((start + speed * t) % (W + len));
    if (lane === 0) {
      const cx = pos - len;
      text(g, cx, 1, label, { fg: ink, bg: body, bold: true });
      put(g, cx + len - 1, 1, '▶', { fg: C.window });
    } else {
      const cx = W - pos;
      put(g, cx, 3, '◀', { fg: C.window });
      text(g, cx + 1, 3, label, { fg: ink, bg: body, bold: true });
    }
  }
  return g;
}

/** One row of cells → a string (consecutive same-style cells share one escape sequence). */
function render(cells, color) {
  let out = '';
  let last = '';
  for (const c of cells) {
    if (!color) {
      out += c.ch;
      continue;
    }
    const style = [c.bold ? '1' : '', c.fg ? fgCode(c.fg) : '', c.bg ? bgCode(c.bg) : ''].filter(Boolean).join(';');
    if (style !== last) out += `\x1b[0m${style ? `\x1b[${style}m` : ''}`;
    last = style;
    out += c.ch;
  }
  // Coloured spaces (the sky, the asphalt) are visible, so only plain mode trims trailing spaces.
  return color ? `${out}\x1b[0m` : out.replace(/\s+$/, '');
}

const fancy = () => process.stdout.isTTY && !process.env.NO_COLOR && !process.env.CI;
const canAnimate = () => fancy() && process.env.AWS_CITY_NO_INTRO !== '1';
/** The big letters need 84 columns and about 24 rows; anything smaller gets the small title and a lower skyline. */
const compactFor = (cols, rows) => cols < 84 || rows < 24;

/** The finished scene (no animation): headers for `npm run live` and `npm run setup`. */
export function printBanner() {
  if (!fancy()) return console.log('\nAWS City: learn AWS by living in it\n');
  const cols = process.stdout.columns ?? 100;
  console.log(`\n${frame(INTRO_SECONDS, cols, { compact: compactFor(cols, process.stdout.rows ?? 40) }).join('\n')}\n`);
}

/**
 * Animates the scene in place (~30 fps, under 3 s): the city grows from its foundations, then the fireworks.
 * Any key skips to the end, Ctrl-C quits. Without a terminal, with NO_COLOR or CI (or `animate: false`) it prints
 * the finished scene, or one line, instead.
 */
export async function playIntro({ animate = true } = {}) {
  if (!animate || !canAnimate()) return printBanner();
  const out = process.stdout;
  const width = out.columns ?? 100;
  const rows = out.rows ?? 40;
  const compact = compactFor(width, rows);
  const height = frame(0, width, { compact }).length;
  // Redrawing moves the cursor up `height` lines: a terminal shorter than that would smear, so just print it.
  if (rows < height + 2) return printBanner();
  const input = process.stdin.isTTY ? process.stdin : undefined;
  let skip = false;
  const onKey = (buf) => {
    if (String(buf).includes('\u0003')) {
      // Ctrl-C: raw mode turned it into a key, so quit here (the exit handlers restore the cursor and input).
      restore();
      out.write('\n');
      process.exit(130);
    }
    skip = true;
  };
  const restore = () => {
    if (input) {
      input.off('data', onKey);
      input.setRawMode(false);
      input.pause();
    }
    out.write('\x1b[?25h');
  };
  process.once('exit', restore);
  try {
    if (input) {
      input.setRawMode(true);
      input.resume();
      input.on('data', onKey);
    }
    out.write(`\x1b[?25l\n${'\n'.repeat(height)}`);
    const started = Date.now();
    for (;;) {
      const t = skip ? INTRO_SECONDS : Math.min(INTRO_SECONDS, (Date.now() - started) / 1000);
      out.write(`\x1b[${height}A\r${frame(t, width, { compact, growth: introGrowth(t) }).map((l) => `${l}\x1b[K`).join('\n')}\n`);
      if (t >= INTRO_SECONDS) break;
      await new Promise((r) => setTimeout(r, 33));
    }
  } finally {
    process.off('exit', restore);
    restore();
  }
  out.write('\n');
}
