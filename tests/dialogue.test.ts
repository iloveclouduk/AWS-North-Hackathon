import { describe, expect, it } from 'vitest';
import { AMBIENT_CHATTER, citizenLines, REPLIES } from '@/world/dialogue';
import { serviceById } from '@/world/taxonomy';

describe('what citizens say', () => {
  const calm = { hour: 13, openFindings: 0, level: 1 };
  it('talks about the moment: an outage, a drill, the night, a grown city', () => {
    const base = citizenLines(calm);
    expect(citizenLines({ ...calm, outage: 'real' }).some((l) => /Region|zone|failover|backups/i.test(l) && !base.includes(l))).toBe(true);
    expect(citizenLines({ ...calm, outage: 'drill' }).some((l) => /drill/i.test(l))).toBe(true);
    expect(citizenLines({ ...calm, outage: 'real' }).some((l) => /drill/i.test(l))).toBe(false);
    expect(citizenLines({ ...calm, hour: 23 }).some((l) => /night/i.test(l))).toBe(true);
    expect(citizenLines({ ...calm, level: 3 }).some((l) => /growing|big/i.test(l))).toBe(true);
    expect(base.length).toBeGreaterThan(10);
    expect(REPLIES.length).toBeGreaterThan(4);
  });

  it('agents only chat with real agents', () => {
    const special = new Set(['concierge', 'lookout', 'builder']);
    for (const [from, to, text] of AMBIENT_CHATTER) {
      for (const id of [from, to]) expect(special.has(id) || !!serviceById(id), id).toBe(true);
      expect(text.length).toBeGreaterThan(5);
    }
  });
});
