import { describe, expect, it } from 'vitest';
import type { AwsHealthEvent, AwsIncident } from '@/backend/contract';
import { demoHealth } from '@/backend/mockAccount';
import { ago, cityImpact, incidentLine, incidentsIn, lessonFor, openIncidents, worstByRegion } from '@/world/incidents';
import { puzzleById } from '@/world/content';
import { SERVICES, serviceById } from '@/world/taxonomy';
import { tickerItems } from '@/ui/NewsTicker';

const inc = (over: Partial<AwsIncident>): AwsIncident => ({
  id: 'x',
  region: 'us-east-1',
  severity: 'degradation',
  status: 'open',
  title: 'Increased error rates',
  services: ['AWS Lambda'],
  serviceCount: 1,
  serviceIds: ['lambda'],
  started: '2026-10-11T10:00:00.000Z',
  updated: '2026-10-11T11:00:00.000Z',
  log: [{ at: '2026-10-11T11:00:00.000Z', text: 'We are investigating.' }],
  ...over,
});
const health = (incidents: AwsIncident[]): AwsHealthEvent => ({ type: 'aws.health', asOf: '2026-10-11T12:00:00.000Z', incidents });

describe('reading AWS Health events in the city', () => {
  it('orders open incidents worst first and leaves resolved ones out', () => {
    const h = health([inc({ id: 'a' }), inc({ id: 'b', severity: 'disruption' }), inc({ id: 'c', status: 'resolved', severity: 'disruption' })]);
    expect(openIncidents(h).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('a Region sees its own incidents and global ones; the world map gets the worst per Region', () => {
    const h = health([inc({ id: 'a', region: 'us-east-1' }), inc({ id: 'g', region: 'global' }), inc({ id: 'b', region: 'us-east-1', severity: 'disruption' }), inc({ id: 'w', region: 'eu-west-1' })]);
    expect(incidentsIn(h, 'us-east-1').map((i) => i.id).sort()).toEqual(['a', 'b', 'g']);
    expect(worstByRegion(h)).toEqual({ 'us-east-1': 'disruption', 'eu-west-1': 'degradation' });
  });

  it('Bahrain 2026 is Region-wide in the city; a one-service event marks only that landmark; notices mark nothing', () => {
    const bahrain = demoHealth().incidents.find((i) => i.region === 'me-south-1')!;
    expect(cityImpact([bahrain], SERVICES.length).regionWide).toBe('disruption');
    expect(cityImpact([bahrain], SERVICES.length).azIds).toEqual(['mes1-az2']);
    const one = cityImpact([inc({})], SERVICES.length);
    expect(one.regionWide).toBeUndefined();
    expect([...one.services]).toEqual([['lambda', 'degradation']]);
    expect(cityImpact([inc({ severity: 'informational' })], SERVICES.length).services.size).toBe(0);
  });

  it('teaches by shape: a lost Region → a second Region (with the drill); a zone → multi-AZ; a service → retries', () => {
    const bahrain = demoHealth().incidents.find((i) => i.region === 'me-south-1')!;
    const region = lessonFor(bahrain, SERVICES.length);
    expect(region.puzzleId).toBe('region-down');
    expect(lessonFor(inc({ azIds: ['use1-az4'] }), SERVICES.length).title).toMatch(/Availability Zones/);
    const svc = lessonFor(inc({}), SERVICES.length);
    expect(svc.practise).toBe('lambda');
    for (const l of [region, svc]) {
      expect(serviceById(l.practise)).toBeTruthy();
      if (l.puzzleId) expect(puzzleById(l.puzzleId)).toBeTruthy();
    }
  });

  it('says it in one line, with a plain time', () => {
    const bahrain = demoHealth().incidents.find((i) => i.region === 'me-south-1')!;
    expect(incidentLine(bahrain)).toMatch(/^Middle East \(Bahrain\) \(me-south-1\): \d+ services disrupted$|^Bahrain \(me-south-1\): \d+ services disrupted$/);
    expect(incidentLine(inc({ status: 'resolved' }))).toMatch(/AWS Lambda recovered$/);
    const now = Date.parse('2026-10-11T12:00:00Z');
    expect(ago('2026-10-11T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-10-11T11:30:00Z', now)).toBe('30 min ago');
    expect(ago('2026-10-11T09:00:00Z', now)).toBe('3 h ago');
    expect(ago('2026-03-02T00:00:00Z', now)).toBe('7 months ago');
  });

  it('the ticker leads with open incidents, then recent recoveries, then fresh launches', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    const items = tickerItems(
      [inc({ id: 'r', status: 'resolved' }), inc({ id: 'old', status: 'resolved', updated: '2026-09-01T00:00:00.000Z' }), inc({ id: 'o', severity: 'disruption' })],
      [{ id: 'n', title: 'Amazon S3 adds a thing', url: 'https://aws.amazon.com/x', date: '2026-10-10T00:00:00.000Z', serviceIds: ['s3'] }],
      now,
    );
    expect(items.map((i) => (i.kind === 'news' ? i.item.id : i.incident.id))).toEqual(['o', 'r', 'n']);
  });

  it("leads with this city's Region; a weeks-old outage elsewhere waits until after the news", () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    const ids = (region?: string) =>
      tickerItems(
        [
          inc({ id: 'uae', region: 'me-central-1', severity: 'disruption', updated: '2026-09-14T00:00:00.000Z' }),
          inc({ id: 'oregon', region: 'us-west-2', severity: 'informational' }),
          inc({ id: 'tokyo', region: 'ap-northeast-1', severity: 'degradation' }),
        ],
        [{ id: 'n', title: 'Amazon S3 adds a thing', url: 'https://aws.amazon.com/x', date: '2026-10-10T00:00:00.000Z', serviceIds: ['s3'] }],
        now,
        region,
      ).map((i) => (i.kind === 'news' ? i.item.id : i.incident.id));
    expect(ids('us-west-2')).toEqual(['oregon', 'tokyo', 'n', 'uae']);
    // In the affected city it leads, however old.
    expect(ids('me-central-1')).toEqual(['uae', 'tokyo', 'oregon', 'n']);
  });

  it('a quiet week still shows the newest launches, with their real dates', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const old = (id: string, date: string) => ({ id, title: id, url: 'https://aws.amazon.com/x', date, serviceIds: [] });
    const items = tickerItems([], [old('a', '2026-10-01T00:00:00.000Z'), old('c', '2026-10-09T00:00:00.000Z'), old('b', '2026-10-05T00:00:00.000Z'), old('d', '2026-09-01T00:00:00.000Z')], now);
    expect(items.map((i) => (i.kind === 'news' ? i.item.id : ''))).toEqual(['c', 'b', 'a']);
  });
});
