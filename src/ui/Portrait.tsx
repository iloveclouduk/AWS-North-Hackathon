import type { CSSProperties } from 'react';
import { placeFor, SPECIAL_AGENTS } from '@/world/places';
import { districtById, hexColor, serviceById } from '@/world/taxonomy';
import { citizenById, citizenSheet } from '@/world/citizens';
import { characterIndex, citizenIds } from '@/game/assets';
import { KAI_SHEET } from '@/world/culture';

/** The sheet that draws a citizen (the same one the city uses; see Patrols). */
export const citizenSheetFor = (id: string) => {
  const c = citizenById(id);
  return c ? citizenSheet(c, (sheet) => !!characterIndex()[sheet], citizenIds()) : undefined;
};

// The head from frame 0 (idle, facing the viewer) of the agent's own sprite sheet (art/characters):
// 48×72 frames on a 480×2880 sheet; the face sits in a 28×28 box at (12, 20).
const SHEET_W = 480;
const SHEET_H = 2880;
const CROP = { x: 12, y: 20, size: 28 };

/** The colour that frames an agent: their district's, a special agent's own, else the accent. */
export function agentColor(id: string): string | undefined {
  const s = serviceById(id);
  if (s) return hexColor(districtById(s.districtId)!.color);
  const special = (SPECIAL_AGENTS as Record<string, { color: number }>)[id];
  if (special) return hexColor(special.color);
  // A citizen: the colour of the first district they look after.
  const c = citizenById(id);
  const d = c && districtById(c.districts[0]);
  return d ? hexColor(d.color) : undefined;
}

/** A pixel portrait of an agent (or the player, id 'user'), cut from their in-game sprite. */
export function Portrait({ id, size = 28, className = '' }: { id: string; size?: number; className?: string }) {
  const sheet =
    id === 'user' || id === 'player' ? KAI_SHEET : placeFor(id) || (SPECIAL_AGENTS as Record<string, unknown>)[id] ? id : citizenSheetFor(id);
  const k = size / CROP.size;
  const style = {
    width: size,
    height: size,
    '--district': agentColor(id),
    ...(sheet
      ? {
          backgroundImage: `url(/assets/characters/${sheet}/sheet.png)`,
          backgroundSize: `${SHEET_W * k}px ${SHEET_H * k}px`,
          backgroundPosition: `${-CROP.x * k}px ${-CROP.y * k}px`,
        }
      : {}),
  } as CSSProperties;
  return <span className={`portrait ${className}`} style={style} aria-hidden="true" />;
}
