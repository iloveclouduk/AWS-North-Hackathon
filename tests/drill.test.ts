import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '@/backend/contract';
import { demoInventory } from '@/backend/mockAccount';
import { drillOutcome, spreadOf } from '@/world/drill';
import { placeResources } from '@/world/resources';
import { zonesFor } from '@/world/regions';

const item = (over: Partial<InventoryItem>): InventoryItem => ({ arn: 'arn:x', type: 'AWS::EC2::Instance', name: 'web', serviceId: 'ec2', districtId: 'compute', managedByGame: false, region: 'us-west-2', ...over });
const islands = zonesFor('us-west-2');
const place = (items: InventoryItem[]) => placeResources(items, islands, 'us-west-2');

describe('lights-out drill', () => {
  it('servers in two zones keep the app running', () => {
    const r = drillOutcome(place([item({ az: 'us-west-2a' }), item({ az: 'us-west-2b' })]), 0);
    expect(r).toMatchObject({ ok: true, empty: false, down: [] });
    expect(r.line).toBe('Your app kept running! 🎉 Servers in two zones.');
  });

  it('everything in the dark zone stops', () => {
    const r = drillOutcome(place([item({ az: 'us-west-2a' }), item({ az: 'us-west-2a', name: 'web-2' })]), 0);
    expect(r).toMatchObject({ ok: false, lucky: false, down: ['server'] });
    expect(r.line).toBe('Uh oh, everything was in Zone A. Put servers in two zones next time.');
  });

  it('one zone that stayed up is luck, not resilience', () => {
    const r = drillOutcome(place([item({ az: 'us-west-2b' })]), 0);
    expect(r).toMatchObject({ ok: false, lucky: true, single: ['server'] });
    expect(r.line).toContain('Zone B');
  });

  it('every kind must span two zones: a database in one zone fails the drill', () => {
    const r = drillOutcome(place([item({ az: 'us-west-2a' }), item({ az: 'us-west-2b' }), item({ type: 'AWS::RDS::DBInstance', serviceId: 'rds', districtId: 'database', name: 'db', az: 'us-west-2a' })]), 0);
    expect(r).toMatchObject({ ok: false, down: ['database'] });
    expect(r.line).toBe('Uh oh, your databases were all in Zone A. Put databases in two zones next time.');
  });

  it('with no zonal resources it says so', () => {
    const r = drillOutcome(place([item({ type: 'AWS::S3::Bucket', serviceId: 's3', districtId: 'storage', name: 'b' })]), 1);
    expect(r).toMatchObject({ empty: true, ok: false });
    expect(r.line).toContain('Zone B');
  });

  it('uses the map’s letters when given', () => {
    expect(drillOutcome(place([item({ az: 'us-west-2a' })]), 0, ['D']).line).toContain('Zone D');
  });

  it('the demo account: servers span three zones, but the database sits in Zone A only', () => {
    const inv = demoInventory();
    const p = placeResources(inv.items, zonesFor('us-west-2'), 'us-west-2', inv.homeRegion);
    const servers = spreadOf(p.zones).find((k) => k.noun === 'server');
    expect(servers?.zones.length).toBeGreaterThanOrEqual(2);
    const a = drillOutcome(p, 0);
    expect(a.ok).toBe(false);
    expect(a.down).toContain('database');
  });
});
