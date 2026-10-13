import { describe, expect, it } from 'vitest';
import facts from '../shared/region-facts.json' with { type: 'json' };
import regions from '../shared/regions.json' with { type: 'json' };
import world from '../shared/world.json' with { type: 'json' };
import { FACTS, monthly, usd } from '@/world/regions';

const SERVICE_IDS = world.services.map((s) => s.id);
const STATUSES = ['available', 'planned', 'considering', 'not-planned', 'outside-partition'];

describe('Region facts (shared/region-facts.json, from the AWS Knowledge MCP server)', () => {
  it('covers every Region on the map, with sources and a date', () => {
    expect(Object.keys(facts.regions).sort()).toEqual(regions.regions.map((r) => r.code).sort());
    expect(facts.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const url of Object.values(facts.docs)) expect(url).toMatch(/^https:\/\/(docs\.)?aws\.amazon\.com\//);
  });

  it('lists real AZ IDs: unique, Region-prefixed, at least three per commercial Region', () => {
    for (const [code, r] of Object.entries(FACTS.regions)) {
      expect(new Set(r.azIds).size, code).toBe(r.azIds.length);
      for (const id of r.azIds) expect(id, code).toMatch(/^[a-z]+\d-az\d+$/);
      if (r.partition === 'aws') expect(r.azIds.length, code).toBeGreaterThanOrEqual(3);
      else expect(r.azIds, code).toEqual([]);
      expect(new Set(r.azIds.map((id) => id.split('-')[0])).size <= 1, code).toBe(true);
    }
    // Pinned anchors, so a broken re-fetch shows up (docs: aws-availability-zones.html).
    expect(FACTS.regions['us-east-1'].azIds).toHaveLength(6);
    expect(FACTS.regions['us-west-2'].azIds).toHaveLength(4);
    expect(FACTS.regions['ap-northeast-1'].azIds).toHaveLength(4);
    expect(FACTS.regions['eu-west-1'].azIds).toEqual(['euw1-az1', 'euw1-az2', 'euw1-az3']);
    expect(FACTS.regions['us-east-1'].optIn).toBe(false);
    expect(FACTS.regions['af-south-1'].optIn).toBe(true);
    expect(FACTS.regions['us-gov-west-1'].partition).toBe('aws-us-gov');
    expect(FACTS.regions['eusc-de-east-1'].partition).toBe('aws-eusc');
    // Opt-in is for standard accounts; the other partitions need their own account instead.
    expect(FACTS.regions['us-gov-west-1'].optIn).toBe(false);
    expect(Object.entries(FACTS.regions).filter(([, r]) => r.independentNames).map(([c]) => c).sort()).toEqual(
      ['ap-northeast-1', 'ap-southeast-1', 'ap-southeast-2', 'eu-west-1', 'sa-east-1', 'us-east-1', 'us-gov-west-1', 'us-west-1', 'us-west-2'],
    );
  });

  it("knows every service's status in every Region", () => {
    for (const [code, r] of Object.entries(FACTS.regions)) {
      expect(Object.keys(r.services).sort(), code).toEqual([...SERVICE_IDS].sort());
      for (const [id, s] of Object.entries(r.services)) {
        expect(STATUSES, `${code} ${id}`).toContain(s.status);
        if (s.launch) expect(s.launch, `${code} ${id}`).toMatch(/^\d{4}( Q[1-4])?$/);
      }
    }
    expect(FACTS.global.every((id) => SERVICE_IDS.includes(id))).toBe(true);
    // Docs overrides: Q Developer is usable well beyond where it's hosted; GovCloud has no CloudFront.
    expect(FACTS.regions['eu-west-2'].services.q.status).toBe('available');
    expect(FACTS.regions['ca-west-1'].services.neptune.status).toBe('available');
    expect(FACTS.regions['us-gov-west-1'].services.cloudfront.status).toBe('outside-partition');
    // The core services are everywhere in the commercial partition.
    for (const [code, r] of Object.entries(FACTS.regions)) if (r.partition === 'aws') for (const id of ['ec2', 's3', 'lambda', 'vpc', 'iam']) expect(r.services[id].status, `${code} ${id}`).toBe('available');
  });

  it('formats prices without float noise', () => {
    expect([usd(0.0104), usd(0.2), usd(0.0000166667), usd(0.023), usd(7.592), usd(0)]).toEqual(['$0.0104', '$0.20', '$0.0000166667', '$0.023', '$7.59', '$0']);
    expect(monthly(0.0104)).toBeCloseTo(7.592, 6);
  });
});
