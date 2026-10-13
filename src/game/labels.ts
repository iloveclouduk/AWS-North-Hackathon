// Map labels' shared rules (the label budget lives in CityScene.syncLabels): keep a label inside the camera view, and
// find which labels collide. Pure geometry on Phaser objects; no store.
import Phaser from 'phaser';

/** An anchor this close outside the view (world px) is pulled in to the view's edge; one further off stays put. */
export const EDGE_REACH = 160;

export interface Pt {
  x: number;
  y: number;
}

/**
 * Where a label anchored at `a` should stand so it stays whole inside `view` (world px): clamped when the anchor is
 * near the view, unchanged when it's far off-screen. Origin-aware (`ox`, `oy` are the label's origin, w/h its display
 * size). `top`: world px at the top of the view the UI covers (the status ticker).
 */
export function inView(a: Pt, w: number, h: number, view: { x: number; y: number; width: number; height: number }, pad: number, top = 0, ox = 0.5, oy = 0.5): Pt {
  if (!view.width) return a;
  const right = view.x + view.width;
  const bottom = view.y + view.height;
  const near = a.x > view.x - EDGE_REACH && a.x < right + EDGE_REACH && a.y > view.y - EDGE_REACH && a.y < bottom + EDGE_REACH;
  if (!near) return a;
  const x = view.width > w + 2 * pad ? Phaser.Math.Clamp(a.x, view.x + pad + w * ox, right - pad - w * (1 - ox)) : a.x;
  const y = view.height > h + 2 * pad + top ? Phaser.Math.Clamp(a.y, view.y + top + pad + h * oy, bottom - pad - h * (1 - oy)) : a.y;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Moves a visible text to stay in view, from its anchor. */
export function keepTextInView(t: Phaser.GameObjects.Text, a: Pt, view: Phaser.Geom.Rectangle, ui: number, topInset = 0) {
  if (!t.visible) return;
  const p = inView(a, t.displayWidth, t.displayHeight, view, 4 * ui, topInset * ui, t.originX, t.originY);
  if (t.x !== p.x || t.y !== p.y) t.setPosition(p.x, p.y);
}

/**
 * Greedy de-overlap: walks `items` in priority order (first wins) and returns the ones that cover none already kept.
 * `gap`: extra world px between labels.
 */
export function nonOverlapping<T>(items: T[], bounds: (t: T) => Phaser.Geom.Rectangle | undefined, gap = 0): Set<T> {
  const kept: Phaser.Geom.Rectangle[] = [];
  const out = new Set<T>();
  for (const it of items) {
    const b = bounds(it);
    if (!b) continue;
    const g = new Phaser.Geom.Rectangle(b.x - gap, b.y - gap, b.width + 2 * gap, b.height + 2 * gap);
    if (kept.some((k) => Phaser.Geom.Intersects.RectangleToRectangle(g, k))) continue;
    kept.push(g);
    out.add(it);
  }
  return out;
}
