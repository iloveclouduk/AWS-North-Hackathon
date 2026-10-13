// Loads the generated pixel art: the city multiatlas (art/tiles/generate_tiles.py) and one spritesheet
// per character (art/characters/aws_city.py), and turns each character's sheet.json into animations
// keyed `<id>:<anim>:<dir>`.
import Phaser from 'phaser';
import { iconIds, iconPath } from '@/world/icons';

export const CITY_ATLAS = 'city';
export const SEA_TEXTURE = 'sea';
export const SEA_GLINT_TEXTURE = 'seaGlint';
export const FRAME_W = 48;
export const FRAME_H = 72;
/** Feet position inside a 48×72 character frame. */
export const PIVOT = { x: 24, y: 67 };

export type Dir = 'SE' | 'SW' | 'NE' | 'NW';
export const DIRS: Dir[] = ['SE', 'SW', 'NE', 'NW'];

interface SheetJson {
  frameWidth: number;
  animations: Record<string, { durationsMs: number[]; loop: boolean; rows: Record<Dir, { row: number; frames: unknown[] }> }>;
}
export interface CharacterIndex {
  /** `crowd`: a 3/4-size copy of citizen `of` (art/characters/crowd_small.py), with its own `frame` size. */
  [id: string]: { role: 'player' | 'agent' | 'citizen' | 'crowd'; anims: string[]; frame?: [number, number]; of?: string };
}
export interface SpriteAnchor {
  ax: number;
  ay: number;
  w: number;
  h: number;
}

let anchors: Record<string, SpriteAnchor> = {};
let characters: CharacterIndex = {};

export const spriteAnchor = (name: string) => anchors[name];
export const hasSprite = (name: string) => name in anchors;
/** Culture/ops sites only exist once their art does: an undrawn site must not block tiles or be a destination. */
export const isPlaced = (l: { site?: { sprite: string } }) => !l.site || hasSprite(l.site.sprite);
export const characterIndex = () => characters;
export const citizenIds = () => Object.entries(characters).filter(([, c]) => c.role === 'citizen').map(([id]) => id);
export const hasAnim = (id: string, anim: string) => !!characters[id]?.anims.includes(anim);
/** A sheet's frame size: 48×72, or a crowd sheet's own. */
export const frameOf = (id: string): [number, number] => characters[id]?.frame ?? [FRAME_W, FRAME_H];
/** The crowd-size copy of a sheet when there is one, so people stand to scale beside the buildings. */
export const crowdSheet = (id: string) => (characters[`${id}-crowd`] ? `${id}-crowd` : id);

export const SFX = ['levelup', 'discover', 'deploy', 'quest', 'click', 'correct', 'wrong', 'pop', 'whoosh', 'door', 'card', 'work', 'step0', 'step1', 'step2'] as const;
export type Sfx = (typeof SFX)[number];

/** Phase 1: small JSON indexes. */
export function preloadIndexes(scene: Phaser.Scene) {
  scene.load.json('city-sprites', '/assets/city/sprites.json');
  scene.load.json('characters', '/assets/characters/index.json');
}

/** Phase 2: everything the indexes point at. Call from create() of the boot scene, then load.start(). */
export function queueAssets(scene: Phaser.Scene) {
  anchors = (scene.cache.json.get('city-sprites') as { sprites: Record<string, SpriteAnchor> }).sprites;
  characters = scene.cache.json.get('characters') as CharacterIndex;
  scene.load.multiatlas(CITY_ATLAS, '/assets/city/atlas.json', '/assets/city/');
  // The sea round the city: standalone seamless textures for TileSprites (art/tiles/landscape_art.py write_sea).
  scene.load.image(SEA_TEXTURE, '/assets/city/sea.png');
  scene.load.image(SEA_GLINT_TEXTURE, '/assets/city/seaGlint.png');
  for (const id of Object.keys(characters)) {
    const [frameWidth, frameHeight] = frameOf(id);
    scene.load.spritesheet(`char:${id}`, `/assets/characters/${id}/sheet.png`, { frameWidth, frameHeight });
    scene.load.json(`charjson:${id}`, `/assets/characters/${id}/sheet.json`);
  }
  // `click` is a synth voice and `step2` is never played (src/game/audio.ts sfx()): no need to fetch them.
  for (const s of SFX) if (s !== 'click' && s !== 'step2') scene.load.audio(`sfx:${s}`, `/assets/kenney/audio/${s}.ogg`);
  // Official AWS Architecture Icons for the building signs (off with WXT_OFFICIAL_ICONS=false).
  for (const id of iconIds()) scene.load.svg(iconKey(id), iconPath(id)!, { width: 16, height: 16 });
}

export const iconKey = (serviceId: string) => `awsicon:${serviceId}`;

/** Phase 3: build animations from each sheet.json. */
export function createCharacterAnims(scene: Phaser.Scene) {
  for (const id of Object.keys(characters)) {
    const tex = scene.textures.get(`char:${id}`);
    const cols = Math.round(tex.getSourceImage().width / frameOf(id)[0]);
    const sheet = scene.cache.json.get(`charjson:${id}`) as SheetJson;
    for (const [anim, a] of Object.entries(sheet.animations)) {
      for (const dir of DIRS) {
        const row = a.rows[dir];
        if (!row) continue;
        const key = `${id}:${anim}:${dir}`;
        if (scene.anims.exists(key)) continue;
        scene.anims.create({
          key,
          frames: row.frames.map((_, i) => ({ key: `char:${id}`, frame: row.row * cols + i, duration: a.durationsMs[i] ?? 150 })),
          repeat: -1,
        });
      }
    }
  }
}

/** Place an atlas sprite so its generator anchor (footprint N corner) sits at world (x, y). */
export function addSprite(scene: Phaser.Scene, name: string, x: number, y: number) {
  const a = anchors[name];
  const img = scene.add.image(x, y, CITY_ATLAS, name);
  if (a) img.setOrigin(a.ax / a.w, a.ay / a.h);
  return img;
}
