// Who's who: turns world data into agent looks/names. Shared by the city and interiors.
import { placeFor, SPECIAL_AGENTS, type ActivityKind } from '@/world/places';
import { districtById, serviceById } from '@/world/taxonomy';
import { lookFor, type Look } from './sprites';

export interface CastMember {
  id: string;
  name: string;
  look: Look;
  activity: ActivityKind;
}

export function castFor(id: string): CastMember | undefined {
  if (id === 'player') {
    return {
      id,
      name: 'You',
      activity: 'fish',
      look: { skin: '#f1c27d', hair: '#151515', hairStyle: 2, shirt: '#ff9900', pants: '#232f3e', hat: undefined, activity: 'fish' },
    };
  }
  const special = (SPECIAL_AGENTS as Record<string, { id: string; name: string; activity: ActivityKind; color: number }>)[id];
  if (special) return { id, name: special.name, activity: special.activity, look: lookFor(id, special.color, special.activity) };
  const svc = serviceById(id);
  const place = placeFor(id);
  if (!svc || !place) return undefined;
  const color = districtById(svc.districtId)?.color ?? 0x888888;
  return { id, name: place.agentName, activity: place.activity, look: lookFor(id, color, place.activity) };
}
