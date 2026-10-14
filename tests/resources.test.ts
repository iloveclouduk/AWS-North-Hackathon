import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '@/backend/contract';
import { demoInventory } from '@/backend/mockAccount';
import { inCity, LANDMARK_CAP, placeResources, PROPS, propLine, ZONE_CAP } from '@/world/resources';
import { zonesFor } from '@/world/regions';
import { serviceById } from '@/world/taxonomy';

const item = (over: Partial<InventoryItem>): InventoryItem => ({ arn: 'arn:x', type: 'AWS::EC2::Instance', name: 'web-1', serviceId: 'ec2', districtId: 'compute', managedByGame: false, region: 'us-west-2', ...over });
const islands = zonesFor('us-west-2');

describe('your resources in the city', () => {
  it('a server stands on its own zone’s island', () => {
    const p = placeResources([item({ az: 'us-west-2b' })], islands, 'us-west-2');
    expect(p.zones[1]!.shown.map((x) => x.item.name)).toEqual(['web-1']);
    expect(propLine(p.zones[1]!.shown[0]!, 1)).toBe('Your server web-1, in Zone B.');
  });

  it('regional things stand by their landmark; unknown kinds go in the district shed', () => {
    const p = placeResources([item({ type: 'AWS::Lambda::Function', serviceId: 'lambda', name: 'cook' }), item({ type: 'AWS::SNS::Topic', serviceId: null, districtId: null, name: 'alerts' })], islands, 'us-west-2');
    expect(p.landmarks.lambda!.shown).toHaveLength(1);
    expect(p.sheds.none!.map((i) => i.name)).toEqual(['alerts']);
  });

  it('caps each island and landmark, counting the rest', () => {
    const many = Array.from({ length: ZONE_CAP + 3 }, (_, i) => item({ name: `s${i}`, az: 'us-west-2a' }));
    const p = placeResources(many, islands, 'us-west-2');
    expect(p.zones[0]).toMatchObject({ more: 3 });
    expect(p.zones[0]!.shown).toHaveLength(ZONE_CAP);
    const fns = Array.from({ length: LANDMARK_CAP + 1 }, (_, i) => item({ type: 'AWS::Lambda::Function', serviceId: 'lambda', name: `f${i}` }));
    expect(placeResources(fns, islands, 'us-west-2').landmarks.lambda!.more).toBe(1);
  });

  it('each Region’s city shows only its own things (global services everywhere)', () => {
    expect(inCity(item({ region: 'eu-west-1' }), 'us-west-2', 'us-west-2')).toBe(false);
    expect(inCity(item({ type: 'AWS::IAM::Role', serviceId: 'iam', region: 'global' }), 'eu-west-1', 'us-west-2')).toBe(true);
    expect(inCity(item({ type: 'AWS::S3::Bucket', serviceId: 's3', region: 'global' }), 'eu-west-1', 'us-west-2')).toBe(false);
  });

  it('the demo account fills the islands and the lake', () => {
    const inv = demoInventory();
    const p = placeResources(inv.items, islands, 'us-west-2', inv.homeRegion);
    expect(p.zones.filter((z) => z.shown.length).length).toBeGreaterThanOrEqual(2);
    expect(p.landmarks.s3?.shown.length).toBeGreaterThan(0);
  });

  it('every mapped kind names a real service’s prop', () => {
    for (const [type, info] of Object.entries(PROPS)) {
      expect(info.noun, type).toBeTruthy();
      expect(type).toMatch(/^AWS::\w+::\w+$/);
    }
    expect(serviceById('ec2')).toBeDefined();
  });
});
