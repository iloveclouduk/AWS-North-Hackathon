import { describe, expect, it } from 'vitest';
import prices from '../shared/prices.json' with { type: 'json' };
import regions from '../shared/regions.json' with { type: 'json' };
import world from '../shared/world.json' with { type: 'json' };

type Entry = { key: string; serviceId: string; usd: number; unit: string; label: string; sku: string; source: string; from: string; byDestination?: Record<string, number> };

const UNITS = new Set(['hour', 'GB-month', '1M requests', '1M request units', 'GB-second', 'GB', '1K requests']);
const services = new Set(world.services.map((s) => s.id));
const byRegion = prices.regions as Record<string, Entry[]>;

describe('shared/prices.json (npm run prices)', () => {
  it('is USD list prices with a date', () => {
    expect(prices.currency).toBe('USD');
    expect(prices.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('covers every commercial Region and explains the skipped ones', () => {
    const covered = new Set([...Object.keys(byRegion), ...prices.skipped.map((s) => s.region)]);
    for (const r of regions.regions) expect(covered.has(r.code), r.code).toBe(true);
    for (const s of prices.skipped) {
      expect(s.region).toMatch(/^(us-gov-|eusc-|cn-)/);
      expect(s.reason.length).toBeGreaterThan(10);
    }
  });

  it('every entry is well formed', () => {
    for (const [region, entries] of Object.entries(byRegion)) {
      expect(entries.length, region).toBeGreaterThan(0);
      const keys = entries.map((e) => e.key);
      expect(new Set(keys).size, `${region}: keys unique`).toBe(keys.length);
      for (const e of entries) {
        const at = `${region} ${e.key}`;
        expect(Number.isFinite(e.usd) && e.usd > 0, at).toBe(true);
        expect(UNITS.has(e.unit), `${at}: unit ${e.unit}`).toBe(true);
        expect(e.source, at).toMatch(/^https:\/\/aws\.amazon\.com\//);
        expect(e.sku.length, at).toBeGreaterThan(0);
        expect(services.has(e.serviceId), `${at}: service ${e.serviceId}`).toBe(true);
        expect(['price-list-bulk', 'pricing-page'], at).toContain(e.from);
        expect(e.label.length, at).toBeLessThanOrEqual(40);
        for (const [to, usd] of Object.entries(e.byDestination ?? {})) {
          expect(byRegion[to] ?? prices.skipped.find((s) => s.region === to), `${at} → ${to}`).toBeTruthy();
          expect(usd, `${at} → ${to}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('us-east-1 matches the published list prices (catches a broken re-fetch)', () => {
    const usd = (key: string) => byRegion['us-east-1'].find((e) => e.key === key)?.usd;
    expect(usd('ec2.t3.micro')).toBe(0.0104);
    expect(usd('ec2.t4g.micro')).toBe(0.0084);
    expect(usd('lambda.requests')).toBe(0.2);
    expect(usd('lambda.gbs.x86')).toBe(0.0000166667);
    expect(usd('s3.standard')).toBe(0.023);
    expect(usd('dt.interaz')).toBe(0.01);
  });
});
