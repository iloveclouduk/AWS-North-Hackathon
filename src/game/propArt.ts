// Small pixel props drawn with Phaser Graphics and baked into textures at first use (no atlas change, no `npm run art`):
// the player's own resources (a house for a server, a vault for a database…), the district shed, the tier flag and
// the sparkle. Each texture is PROP_W×PROP_H with its ground point at (PROP_W / 2, PROP_GROUND), so an image with
// origin PROP_ORIGIN stands on the centre of a tile. Colours come from the theme's tokens.
import type Phaser from 'phaser';
import type { PropKind } from '@/world/resources';
import { COLOR } from './theme';

export const PROP_W = 24;
export const PROP_H = 28;
export const PROP_GROUND = 22;
export const PROP_ORIGIN = { x: 0.5, y: PROP_GROUND / PROP_H } as const;

export type ArtKind = PropKind | 'shed';
export const propTexture = (kind: ArtKind) => `res:${kind}`;
export const flagTexture = (color: number) => `tier:flag:${color.toString(16)}`;
export const SPARKLE_TEXTURE = 'tier:sparkle';

const OUTLINE = COLOR.bgDeep;
/** Graphics' point lists are typed as Vector2s but read only x and y. */
const v = (pts: { x: number; y: number }[]) => pts as Phaser.Math.Vector2[];
/** A colour a little darker or lighter (for the shaded faces). */
const shade = (c: number, f: number) => {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((c >> s) & 0xff) * f)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/**
 * An isometric box standing on (cx, gy): a ground diamond `a` px half-wide (2:1, like the city's tiles), `h` px tall.
 * Left face darker, right face mid, top lightest: the city's light comes from the north-west.
 */
function box(g: Phaser.GameObjects.Graphics, cx: number, gy: number, a: number, h: number, color: number) {
  const b = a / 2;
  const W = { x: cx - a, y: gy }, S = { x: cx, y: gy + b }, E = { x: cx + a, y: gy }, N = { x: cx, y: gy - b };
  const up = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - h });
  const face = (pts: { x: number; y: number }[], c: number) => {
    g.fillStyle(c, 1).fillPoints(v(pts), true);
    g.lineStyle(1, OUTLINE, 0.9).strokePoints(v(pts), true);
  };
  face([W, S, up(S), up(W)], shade(color, 0.68));
  face([S, E, up(E), up(S)], shade(color, 0.85));
  face([up(N), up(E), up(S), up(W)], shade(color, 1.1));
}

/** A pyramid roof over a box top centred on (cx, cy), `a` px half-wide as the box, its apex `rise` px up. */
function roof(g: Phaser.GameObjects.Graphics, cx: number, cy: number, a: number, rise: number, color: number) {
  const b = a / 2;
  const W = { x: cx - a - 1, y: cy }, S = { x: cx, y: cy + b + 1 }, E = { x: cx + a + 1, y: cy }, top = { x: cx, y: cy - rise };
  g.fillStyle(shade(color, 0.85), 1).fillPoints(v([W, S, top]), true);
  g.fillStyle(color, 1).fillPoints(v([S, E, top]), true);
  g.lineStyle(1, OUTLINE, 0.9).strokePoints(v([W, S, E, top]), true);
}

const CX = PROP_W / 2;
const GY = PROP_GROUND;

const DRAW: Record<ArtKind, (g: Phaser.GameObjects.Graphics) => void> = {
  // A little house: a server is "a computer you rent", someone's home on the island.
  house: (g) => {
    box(g, CX, GY, 8, 7, COLOR.ink);
    roof(g, CX, GY - 7, 8, 9, COLOR.accent);
    g.fillStyle(COLOR.goldHi, 1).fillRect(CX + 2, GY - 4, 2, 2).fillRect(CX - 5, GY - 4, 2, 2);
  },
  // A vault: a database (and a KMS key) keeps things safe.
  vault: (g) => {
    box(g, CX, GY, 8, 9, COLOR.muted);
    g.fillStyle(COLOR.gold, 1).fillCircle(CX + 3, GY - 4, 2.5);
    g.fillStyle(OUTLINE, 1).fillRect(CX + 3, GY - 5, 1, 2);
  },
  // A locker: a disk, attached next door.
  locker: (g) => {
    box(g, CX, GY, 5, 12, COLOR.info);
    g.fillStyle(OUTLINE, 0.8).fillRect(CX + 1, GY - 9, 3, 1).fillRect(CX + 1, GY - 5, 3, 1);
  },
  // A rowing boat with a sail: a bucket on the lake.
  boat: (g) => {
    g.fillStyle(0x8b5a2b, 1).fillPoints(v([{ x: CX - 8, y: GY - 2 }, { x: CX + 8, y: GY - 2 }, { x: CX + 5, y: GY + 2 }, { x: CX - 5, y: GY + 2 }]), true);
    g.lineStyle(1, OUTLINE, 0.9).strokePoints(v([{ x: CX - 8, y: GY - 2 }, { x: CX + 8, y: GY - 2 }, { x: CX + 5, y: GY + 2 }, { x: CX - 5, y: GY + 2 }]), true);
    g.fillStyle(OUTLINE, 1).fillRect(CX, GY - 15, 1, 13);
    g.fillStyle(COLOR.inkHi, 1).fillTriangle(CX + 1, GY - 15, CX + 1, GY - 4, CX + 7, GY - 4);
    g.fillStyle(COLOR.accent, 1).fillRect(CX - 6, GY - 3, 12, 1);
  },
  // A food cart with a striped awning: a function, cooked when ordered.
  cart: (g) => {
    box(g, CX, GY - 2, 7, 5, COLOR.ink);
    g.fillStyle(OUTLINE, 1).fillCircle(CX - 4, GY, 1.5).fillCircle(CX + 4, GY, 1.5);
    g.fillStyle(COLOR.bad, 1).fillRect(CX - 8, GY - 13, 16, 3);
    g.fillStyle(COLOR.inkHi, 1).fillRect(CX - 5, GY - 13, 3, 3).fillRect(CX + 1, GY - 13, 3, 3);
    g.fillStyle(OUTLINE, 1).fillRect(CX - 7, GY - 10, 1, 4).fillRect(CX + 6, GY - 10, 1, 4);
  },
  // A filing cabinet: a table of items.
  cabinet: (g) => {
    box(g, CX, GY, 6, 11, COLOR.good);
    g.fillStyle(OUTLINE, 0.8).fillRect(CX + 1, GY - 9, 4, 1).fillRect(CX + 1, GY - 6, 4, 1).fillRect(CX + 1, GY - 3, 4, 1);
  },
  // A mailbox on a post: a queue of messages.
  mailbox: (g) => {
    g.fillStyle(OUTLINE, 1).fillRect(CX, GY - 8, 1, 9);
    box(g, CX, GY - 8, 4, 4, COLOR.bad);
    g.fillStyle(COLOR.warn, 1).fillRect(CX + 4, GY - 16, 1, 4);
  },
  // A shipping crate: a container service or cluster.
  crate: (g) => {
    box(g, CX, GY, 7, 7, 0xb07a3c);
    g.lineStyle(1, OUTLINE, 0.7).lineBetween(CX, GY + 3, CX + 7, GY - 7).lineBetween(CX, GY - 4, CX + 7, GY);
  },
  // A barrel: a shared file system.
  barrel: (g) => {
    g.fillStyle(0x8b5a2b, 1).fillRect(CX - 5, GY - 10, 10, 10);
    g.fillStyle(shade(0x8b5a2b, 1.2), 1).fillEllipse(CX, GY - 10, 10, 4);
    g.fillStyle(shade(0x8b5a2b, 0.9), 1).fillEllipse(CX, GY, 10, 4);
    g.fillStyle(COLOR.info, 1).fillRect(CX - 5, GY - 7, 10, 1).fillRect(CX - 5, GY - 3, 10, 1);
    g.lineStyle(1, OUTLINE, 0.9).strokeRect(CX - 5, GY - 10, 10, 10);
  },
  // A ticket kiosk: an API, or a user pool's front desk.
  kiosk: (g) => {
    box(g, CX, GY, 6, 9, COLOR.info);
    g.fillStyle(COLOR.accent, 1).fillRect(CX - 7, GY - 15, 14, 3);
    g.fillStyle(COLOR.goldHi, 1).fillRect(CX + 1, GY - 7, 4, 3);
  },
  // A badge on a stand: a role or a security group.
  badge: (g) => {
    g.fillStyle(OUTLINE, 1).fillRect(CX, GY - 6, 1, 7);
    g.fillStyle(COLOR.gold, 1).fillPoints(v([{ x: CX - 4, y: GY - 15 }, { x: CX + 5, y: GY - 15 }, { x: CX + 5, y: GY - 10 }, { x: CX, y: GY - 6 }, { x: CX - 4, y: GY - 10 }]), true);
    g.lineStyle(1, OUTLINE, 0.9).strokePoints(v([{ x: CX - 4, y: GY - 15 }, { x: CX + 5, y: GY - 15 }, { x: CX + 5, y: GY - 10 }, { x: CX, y: GY - 6 }, { x: CX - 4, y: GY - 10 }]), true);
    g.fillStyle(COLOR.goldHi, 1).fillRect(CX - 1, GY - 13, 3, 3);
  },
  // A signpost: a domain or a distribution.
  sign: (g) => {
    g.fillStyle(OUTLINE, 1).fillRect(CX, GY - 12, 1, 13);
    g.fillStyle(COLOR.highlight, 1).fillRect(CX - 6, GY - 16, 13, 6);
    g.lineStyle(1, OUTLINE, 0.9).strokeRect(CX - 6, GY - 16, 13, 6);
    g.fillStyle(COLOR.info, 1).fillRect(CX - 4, GY - 14, 9, 1);
  },
  // A short fence: a network or subnet.
  fence: (g) => {
    g.fillStyle(COLOR.inkSoft, 1);
    for (let i = 0; i < 4; i++) g.fillRect(CX - 8 + i * 5, GY - 7 + Math.round(i * 2.5), 2, 7);
    g.lineStyle(2, COLOR.inkSoft, 1).lineBetween(CX - 8, GY - 5, CX + 8, GY + 3);
    g.lineStyle(1, OUTLINE, 0.6).lineBetween(CX - 8, GY - 3, CX + 8, GY + 5);
  },
  // The district's shed: things the city has no prop for yet.
  shed: (g) => {
    box(g, CX, GY, 9, 7, 0x9a7b55);
    roof(g, CX, GY - 7, 9, 7, COLOR.muted);
    g.fillStyle(OUTLINE, 0.9).fillRect(CX + 2, GY - 5, 3, 5);
  },
};

/** Bakes a prop's texture once per game (textures outlive scenes). */
export function ensurePropTexture(scene: Phaser.Scene, kind: ArtKind) {
  const key = propTexture(kind);
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  DRAW[kind](g);
  g.generateTexture(key, PROP_W, PROP_H);
  g.destroy();
  return key;
}

/** A pennant on a pole in a district's colour (the Novice tier's flag). Origin: the pole's foot. */
export function ensureFlagTexture(scene: Phaser.Scene, color: number) {
  const key = flagTexture(color);
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(OUTLINE, 1).fillRect(CX - 1, 3, 2, GY - 2);
  g.fillStyle(COLOR.inkSoft, 1).fillRect(CX - 1, 3, 1, GY - 2);
  g.fillStyle(color, 1).fillTriangle(CX + 1, 4, CX + 1, 12, CX + 10, 8);
  g.lineStyle(1, OUTLINE, 0.9).strokeTriangle(CX + 1, 4, CX + 1, 12, CX + 10, 8);
  g.fillStyle(COLOR.gold, 1).fillRect(CX - 1, 1, 2, 2);
  g.generateTexture(key, PROP_W, PROP_H);
  g.destroy();
  return key;
}

/** A four-point twinkle (the Master tier's sparkle on a visit). */
export function ensureSparkleTexture(scene: Phaser.Scene) {
  if (scene.textures.exists(SPARKLE_TEXTURE)) return SPARKLE_TEXTURE;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(COLOR.goldHi, 1).fillRect(3, 0, 1, 7).fillRect(0, 3, 7, 1);
  g.fillStyle(0xffffff, 1).fillRect(3, 3, 1, 1);
  g.generateTexture(SPARKLE_TEXTURE, 7, 7);
  g.destroy();
  return SPARKLE_TEXTURE;
}
