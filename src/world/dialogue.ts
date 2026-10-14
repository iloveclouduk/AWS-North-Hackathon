// What citizens say and what agents say to each other (shared/dialogue.json). A citizen's line depends on the moment:
// the time of day, an AWS outage over the city, open problems, how grown the city is.
import json from '../../shared/dialogue.json' with { type: 'json' };

type Mood = 'morning' | 'evening' | 'night' | 'findings' | 'outage' | 'drill' | 'grown';
const DATA = json as unknown as { citizen: Record<'any' | Mood, string[]>; replies: string[]; ambient: [string, string, string][] };

export const REPLIES = DATA.replies;
export const AMBIENT_CHATTER = DATA.ambient;

export interface ChatContext {
  hour: number;
  /** An AWS Health event is open over this city (`drill` = the demo's practice one). */
  outage?: 'real' | 'drill';
  openFindings: number;
  /** Average landmark tier, 0–4. */
  level: number;
}

/** The lines a citizen may say right now: the everyday ones plus those for the moment (the moment's lines weigh more). */
export function citizenLines(ctx: ChatContext): string[] {
  const moods: Mood[] = [];
  if (ctx.outage) moods.push(ctx.outage === 'drill' ? 'drill' : 'outage');
  if (ctx.openFindings > 0) moods.push('findings');
  if (ctx.level >= 2.5) moods.push('grown');
  if (ctx.hour >= 5 && ctx.hour < 11) moods.push('morning');
  else if (ctx.hour >= 17 && ctx.hour < 22) moods.push('evening');
  else if (ctx.hour >= 22 || ctx.hour < 5) moods.push('night');
  // An outage crowds out small talk: half of what's said is about it.
  const special = moods.flatMap((m) => DATA.citizen[m]);
  return [...DATA.citizen.any, ...special, ...special];
}
