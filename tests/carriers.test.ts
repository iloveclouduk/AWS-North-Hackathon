// Data carriers (src/world/carriers.ts): every kind of data link has a vehicle, a drawing in four facings and plain
// words for its card, and they never crowd the ambient traffic off the roads.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARRIER_FOR, CARRIER_KINDS, CARRIERS, carrierSkin, carsPerMinute, DATA_CAP, MAX_CARS_PER_MIN } from '@/world/carriers';
import { VEHICLE_CAP } from '@/world/traffic';

const sprites = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/assets/city/sprites.json'), 'utf8')).sprites as Record<string, unknown>;

describe('data carriers', () => {
  it('every kind of data link has a carrier', () => {
    for (const kind of ['replication', 'standby', 'traffic'] as const) expect(CARRIER_KINDS).toContain(CARRIER_FOR[kind]);
  });

  it('every carrier is drawn in all four facings (npm run art)', () => {
    for (const k of CARRIER_KINDS) for (const d of ['SE', 'SW', 'NE', 'NW']) expect(sprites[`${carrierSkin(k)}:${d}`], `${k} ${d}`).toBeTruthy();
  });

  it('every carrier says what it carries in plain words, with an https AWS docs source', () => {
    for (const k of CARRIER_KINDS) {
      const c = CARRIERS[k];
      expect(c.name.length, k).toBeGreaterThan(3);
      expect(c.simple.length, k).toBeLessThanOrEqual(110);
      expect(c.simple, k).not.toMatch(/—/);
      expect(c.more.length, k).toBeGreaterThan(c.simple.length);
      expect(c.source, k).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
    }
  });

  it('leave room for the ambient traffic on every surface', () => {
    for (const s of ['panel', 'tab'] as const) expect(DATA_CAP[s]).toBeLessThan(VEHICLE_CAP[s] / 2 + 1);
  });

  it('live traffic: more requests, more cars, log-scaled and capped, and junk numbers drive nothing', () => {
    expect([0, 1, 10, 100, 1000, 1e6].map(carsPerMinute)).toEqual([0, 1, 2, 4, 5, MAX_CARS_PER_MIN]);
    for (const bad of [-5, NaN, Infinity]) expect(carsPerMinute(bad)).toBe(0);
  });
});
