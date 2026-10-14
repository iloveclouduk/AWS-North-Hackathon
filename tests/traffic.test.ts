import { describe, expect, it } from 'vitest';
import type { CityBillEvent, CityInventoryEvent } from '@/backend/contract';
import { billBoost, resourcesIn, surfaceFor, trafficLevel, VEHICLE_CAP } from '@/world/traffic';

const inv = (regions: Record<string, number>): CityInventoryEvent => ({
  type: 'city.inventory',
  takenAt: '2026-10-01T00:00:00Z',
  region: 'us-east-1',
  source: 'mock',
  complete: true,
  counts: {},
  items: [],
  truncated: false,
  homeRegion: 'us-east-1',
  regions,
});
const bill = (byRegion: Record<string, number>): CityBillEvent => ({
  type: 'city.bill',
  month: '2026-10',
  currency: 'USD',
  total: Object.values(byRegion).reduce((a, b) => a + b, 0),
  byService: {},
  byRegion,
  takenAt: '2026-10-01T00:00:00Z',
  estimated: true,
});

describe('trafficLevel (plan B3)', () => {
  it('starts at 4 with no account, in either surface', () => {
    expect(trafficLevel(undefined, undefined, 'us-east-1', 'tab')).toBe(4);
    expect(trafficLevel(undefined, undefined, 'us-east-1', 'panel')).toBe(4);
  });

  it('adds 2·log2(1 + resources here), counting only this Region', () => {
    expect(trafficLevel(inv({ 'us-east-1': 1 }), undefined, 'us-east-1', 'tab')).toBe(6);
    expect(trafficLevel(inv({ 'us-east-1': 3 }), undefined, 'us-east-1', 'tab')).toBe(8);
    expect(trafficLevel(inv({ 'us-east-1': 3 }), undefined, 'eu-west-1', 'tab')).toBe(4);
  });

  it('adds up to 3 from this Region’s bill, and nothing for a bill that could not be read', () => {
    expect(billBoost(bill({ 'us-east-1': 5 }), 'us-east-1')).toBe(0);
    expect(billBoost(bill({ 'us-east-1': 12 }), 'us-east-1')).toBe(1);
    expect(billBoost(bill({ 'us-east-1': 250 }), 'us-east-1')).toBe(2);
    expect(billBoost(bill({ 'us-east-1': 1e6 }), 'us-east-1')).toBe(3);
    expect(billBoost(bill({ 'eu-west-1': 1e6 }), 'us-east-1')).toBe(0);
    expect(billBoost({ type: 'city.bill', unavailable: 'No access', takenAt: '' }, 'us-east-1')).toBe(0);
    expect(trafficLevel(undefined, bill({ 'us-east-1': 250 }), 'us-east-1', 'tab')).toBe(6);
  });

  it('is capped at 8 in the side panel and 14 in the tab', () => {
    const huge = inv({ 'us-east-1': 100_000 });
    const rich = bill({ 'us-east-1': 1e6 });
    expect(trafficLevel(huge, rich, 'us-east-1', 'panel')).toBe(VEHICLE_CAP.panel);
    expect(trafficLevel(huge, rich, 'us-east-1', 'tab')).toBe(VEHICLE_CAP.tab);
    expect(VEHICLE_CAP).toEqual({ panel: 8, tab: 14 });
  });

  it('never drops as the account grows or the bill rises', () => {
    for (const surface of ['panel', 'tab'] as const) {
      let last = 0;
      for (let n = 0; n <= 5000; n = n < 10 ? n + 1 : n * 2) {
        for (const dollars of [0, 9, 10, 99, 100, 5000]) {
          const lv = trafficLevel(inv({ 'us-east-1': n }), bill({ 'us-east-1': dollars }), 'us-east-1', surface);
          expect(lv).toBeGreaterThanOrEqual(dollars === 0 ? last : trafficLevel(inv({ 'us-east-1': n }), undefined, 'us-east-1', surface));
        }
        const base = trafficLevel(inv({ 'us-east-1': n }), undefined, 'us-east-1', surface);
        expect(base).toBeGreaterThanOrEqual(last);
        last = base;
      }
    }
  });

  it('counts listed items by Region when the server sent no per-Region totals', () => {
    const items = [
      { arn: 'a', type: 't', name: 'a', serviceId: 's3', districtId: 'storage', managedByGame: false },
      { arn: 'b', type: 't', name: 'b', serviceId: 's3', districtId: 'storage', managedByGame: false, region: 'eu-west-1' },
    ];
    const i = { ...inv({}), regions: undefined, items };
    expect(resourcesIn(i, 'us-east-1')).toBe(1);
    expect(resourcesIn(i, 'eu-west-1')).toBe(1);
  });

  it('picks the surface from the canvas width', () => {
    expect(surfaceFor(400)).toBe('panel');
    expect(surfaceFor(1280)).toBe('tab');
  });
});
