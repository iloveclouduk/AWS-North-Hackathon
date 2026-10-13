import { describe, expect, it } from 'vitest';
import flowsJson from '../shared/flows.json' with { type: 'json' };
import { CERTS, certCode, CITY_REGION, CULTURE, FLOWS, REGIONS, WORLD_MAP } from '@/world/culture';
import { DISTRICTS } from '@/world/taxonomy';

/** Every sourced entry, wherever it sits in the data. */
const sourced = (o: unknown, out: { source: string; asOf?: string }[] = []) => {
  if (Array.isArray(o)) o.forEach((x) => sourced(x, out));
  else if (o && typeof o === 'object') {
    if ('source' in o) out.push(o as { source: string; asOf?: string });
    Object.values(o).forEach((x) => sourced(x, out));
  }
  return out;
};

/** Facts about Amazon and AWS come from Amazon's own sites (and the AWS Knowledge MCP server). */
const OFFICIAL = /^https:\/\/(www\.aboutamazon\.com|www\.amazon\.jobs|aws\.amazon\.com|docs\.aws\.amazon\.com|logistics\.amazon\.com|knowledge-mcp\.global\.api\.aws)\b/;

describe('culture, certifications, regions and flows data', () => {
  it('every fact names an official source and when it was checked', () => {
    const entries = [CULTURE, CERTS, REGIONS, flowsJson].flatMap((d) => sourced(d));
    expect(entries.length).toBeGreaterThan(100);
    for (const e of entries) {
      expect(e.source, JSON.stringify(e).slice(0, 120)).toMatch(OFFICIAL);
      expect(e.asOf, e.source).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it('certifications map to real districts and levels', () => {
    const districts = new Set(DISTRICTS.map((d) => d.id));
    const levels = new Set(CERTS.levels.map((l) => l.id));
    for (const c of CERTS.certifications) {
      expect(levels.has(c.level), c.id).toBe(true);
      for (const d of c.districts) expect(districts.has(d), `${c.id} → ${d}`).toBe(true);
    }
  });

  it('shows the exam code you would book today: the new version once its date comes', () => {
    const dva = CERTS.certifications.find((c) => c.id === 'developer-associate')!;
    expect(certCode(dva, new Date('2026-10-26T12:00:00Z'))).toBe('DVA-C02');
    expect(certCode(dva, new Date('2026-10-27T00:00:00Z'))).toBe('DVA-C03');
    for (const c of CERTS.certifications) if (c.next) expect(c.next.from, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('the city sits in a real Region, and every flow uses services the city has', () => {
    expect(CITY_REGION?.code).toBe(REGIONS.cityRegion);
    // FLOWS drops flows naming unknown services; none should be dropped silently.
    expect(FLOWS).toHaveLength(flowsJson.flows.length);
  });

  it('the world map mask matches its declared size', () => {
    expect(WORLD_MAP.mask).toHaveLength(WORLD_MAP.rows);
    for (const row of WORLD_MAP.mask) expect(row).toHaveLength(WORLD_MAP.cols);
  });
});

describe('a goal certification', () => {
  it('shows each district it needs, and how far each one is', async () => {
    const { certProgress } = await import('@/world/culture');
    const c = CERTS.certifications.find((x) => x.level === 'associate')!;
    const empty = { version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00.000Z' } as const;
    const steps = certProgress(empty, c);
    expect(steps.map((x) => x.districtId)).toEqual(c.districts);
    expect(steps.every((x) => !x.done && x.tier === 0 && x.need >= 1)).toBe(true);
  });
});
