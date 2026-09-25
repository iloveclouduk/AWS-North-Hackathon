// Who's who: names and work animations for every character id (sprites come from art/characters).
import { placeFor, SPECIAL_AGENTS, type ActivityKind } from '@/world/places';

export interface CastMember {
  id: string;
  name: string;
  activity: ActivityKind | 'none';
}

export function castFor(id: string): CastMember | undefined {
  if (id === 'player') return { id, name: 'You', activity: 'none' };
  const special = (SPECIAL_AGENTS as Record<string, { name: string; activity: ActivityKind }>)[id];
  if (special) return { id, name: special.name, activity: special.activity };
  const place = placeFor(id);
  if (place) return { id, name: place.agentName, activity: place.activity };
  return undefined;
}

/** The character-sheet animation that shows this activity. */
export const workAnimFor = (a: ActivityKind | 'none') => (a === 'none' ? 'talk' : a);
