// Loads the generated pixel art: the city multiatlas (art/tiles/generate_tiles.py) and one spritesheet
// per character (art/characters/aws_city.py), and turns each character's sheet.json into animations
// keyed `<id>:<anim>:<dir>`.
import Phaser from 'phaser';

export const CITY_ATLAS = 'city';
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
  [id: string]: { role: 'player' | 'agent' | 'citizen'; anims: string[] };
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
export const characterIndex = () => characters;
export const citizenIds = () => Object.entries(characters).filter(([, c]) => c.role === 'citizen').map(([id]) => id);
export const hasAnim = (id: string, anim: string) => !!characters[id]?.anims.includes(anim);

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
  for (const id of Object.keys(characters)) {
    scene.load.spritesheet(`char:${id}`, `/assets/characters/${id}/sheet.png`, { frameWidth: FRAME_W, frameHeight: FRAME_H });
    scene.load.json(`charjson:${id}`, `/assets/characters/${id}/sheet.json`);
  }
  for (const s of SFX) scene.load.audio(`sfx:${s}`, `/assets/kenney/audio/${s}.ogg`);
}

/** Phase 3: build animations from each sheet.json. */
export function createCharacterAnims(scene: Phaser.Scene) {
  for (const id of Object.keys(characters)) {
    const tex = scene.textures.get(`char:${id}`);
    const cols = Math.round(tex.getSourceImage().width / FRAME_W);
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
