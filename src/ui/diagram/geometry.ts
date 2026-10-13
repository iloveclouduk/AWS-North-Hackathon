// Diagram geometry in SVG units: a grid of cells, each with a lane at the top for group label tabs,
// right-angle arrows between box centres, and points along them for the data packets.
import type { Diagram, DiagramEdge, DiagramGroup, DiagramNode } from '@/world/content';

export const CELL_W = 72;
export const CELL_H = 100;
/** Slot box size; badges (attached to a corner) are smaller. */
export const BOX = 44;
export const BADGE = 24;
const TAB_H = 13;
/** Group kinds drawn with an AWS group icon in their label tab. */
const GROUP_ICON_KINDS = { cloud: 1, region: 1, vpc: 1, public: 1, private: 1 };

export interface Pt {
  x: number;
  y: number;
}

/** The drawing's size; a little extra at the bottom so the last row's two-line labels aren't clipped. */
export const viewBox = (d: Diagram) => ({ w: d.cols * CELL_W, h: d.rows * CELL_H + 8 });

/** Where an edge's step badge sits: mid-way, further along when the arrow drops out of a box (clear of its label). */
export function badgeAt(pts: Pt[]): Pt {
  // An elbow: the middle of its last leg, so arrows that leave a box together keep their badges apart.
  if (pts.length === 3) return pointAt([pts[1], pts[2]], 0.5);
  const down = pts.length === 2 && pts[1].x === pts[0].x && pts[1].y > pts[0].y;
  return pointAt(pts, down ? 0.75 : 0.5);
}

export function nodeCenter(d: Diagram, n: DiagramNode): Pt {
  if (n.attachTo) {
    const host = d.nodes.find((x) => x.id === n.attachTo);
    if (host) {
      const c = nodeCenter(d, host);
      // Mostly outside the host's top-right corner, so it reads as a badge rather than a stray box.
      return { x: c.x + BOX / 2 + 6, y: c.y - BOX / 2 - 4 };
    }
  }
  return { x: n.x * CELL_W + CELL_W / 2, y: n.y * CELL_H + 52 };
}

const inside = (a: DiagramGroup, b: DiagramGroup) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** How many groups enclose this one (equal boxes: the earlier one is outside). */
export function groupDepth(d: Diagram, g: DiagramGroup): number {
  const i = d.groups.indexOf(g);
  return d.groups.filter((o, j) => o !== g && inside(g, o) && (!inside(o, g) || j < i)).length;
}

export function groupRect(d: Diagram, g: DiagramGroup) {
  const k = groupDepth(d, g);
  // Label tabs stack only under enclosing groups that start on the same row (others' tabs are higher up).
  const lane = d.groups.filter((o) => o !== g && o.y === g.y && inside(g, o) && (!inside(o, g) || d.groups.indexOf(o) < d.groups.indexOf(g))).length;
  const x = g.x * CELL_W + 3 + k * 5;
  const y = g.y * CELL_H + 3 + lane * TAB_H;
  return { x, y, w: (g.x + g.w) * CELL_W - 3 - k * 5 - x, h: (g.y + g.h) * CELL_H - 1 - k * 2 - y, tab: { x, y, h: TAB_H, w: Math.round(g.label.length * 4.5 + (g.kind in GROUP_ICON_KINDS ? 19 : 8)) } };
}

const half = (n: DiagramNode) => (n.attachTo ? BADGE : BOX) / 2;

/** The arrow's polyline, trimmed to the edges of the two boxes (the end leaves room for the arrowhead). */
export function edgePoints(d: Diagram, e: DiagramEdge): Pt[] {
  const a = d.nodes.find((n) => n.id === e.from);
  const b = d.nodes.find((n) => n.id === e.to);
  if (!a || !b) return [];
  const p = nodeCenter(d, a);
  const q = nodeCenter(d, b);
  const pts: Pt[] = p.x === q.x || p.y === q.y ? [p, q] : e.bend === 'v' ? [p, { x: p.x, y: q.y }, q] : [p, { x: q.x, y: p.y }, q];
  return [toward(pts[0], pts[1], half(a) + 2), ...pts.slice(1, -1), toward(pts.at(-1)!, pts.at(-2)!, half(b) + 5)];
}

/** `from` moved `by` units toward `to` (axis-aligned segments). */
function toward(from: Pt, to: Pt, by: number): Pt {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: Math.round(from.x + ((to.x - from.x) / len) * by), y: Math.round(from.y + ((to.y - from.y) / len) * by) };
}

export const pathD = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

/** The point a fraction `t` (0–1) of the way along a polyline, on whole units so it stays crisp. */
export function pointAt(pts: Pt[], t: number): Pt {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let left = Math.max(0, Math.min(1, t)) * segs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i] || i === segs.length - 1) {
      const f = segs[i] ? Math.min(1, left / segs[i]) : 0;
      return { x: Math.round(pts[i].x + (pts[i + 1].x - pts[i].x) * f), y: Math.round(pts[i].y + (pts[i + 1].y - pts[i].y) * f) };
    }
    left -= segs[i];
  }
  return pts.at(-1)!;
}

/** A small arrowhead at the end of the polyline, pointing along the last segment. */
export function arrowHead(pts: Pt[]): string {
  if (pts.length < 2) return '';
  const end = pts.at(-1)!;
  const prev = pts.at(-2)!;
  const dx = Math.sign(end.x - prev.x);
  const dy = Math.sign(end.y - prev.y);
  const tip = { x: end.x + dx * 5, y: end.y + dy * 5 };
  const l = { x: end.x - dy * 4, y: end.y + dx * 4 };
  const r = { x: end.x + dy * 4, y: end.y - dx * 4 };
  return `${tip.x},${tip.y} ${l.x},${l.y} ${r.x},${r.y}`;
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/** The nearest point in the arrow's direction (for moving focus between slots), or undefined. */
export function nextSlot<T extends { id: string; at: Pt }>(slots: T[], fromId: string, key: ArrowKey): T | undefined {
  const from = slots.find((s) => s.id === fromId);
  if (!from) return slots[0];
  const dir = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } }[key];
  let best: T | undefined;
  let bestCost = Infinity;
  for (const s of slots) {
    if (s.id === fromId) continue;
    const dx = s.at.x - from.at.x;
    const dy = s.at.y - from.at.y;
    const along = dx * dir.x + dy * dir.y;
    if (along <= 0) continue;
    const across = Math.abs(dx * dir.y) + Math.abs(dy * dir.x);
    const cost = along + across * 2;
    if (cost < bestCost) [best, bestCost] = [s, cost];
  }
  return best;
}

/** Split a label into at most two lines near the middle. */
export function twoLines(text: string, max = 15): string[] {
  if (text.length <= max) return [text];
  const mid = text.length / 2;
  const spaces = [...text.matchAll(/ /g)].map((m) => m.index!);
  if (!spaces.length) return [text];
  const cut = spaces.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
  return [text.slice(0, cut), text.slice(cut + 1)];
}
