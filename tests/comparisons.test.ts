// "Which one should I pick?" cards (shared/comparisons.json): real services, plain words, a side-by-side for each, and
// an AWS docs source.
import { describe, expect, it } from 'vitest';
import { COMPARISONS, comparisonsFor } from '@/world/comparisons';
import { SERVICES } from '@/world/taxonomy';

const ids = new Set(SERVICES.map((s) => s.id));

describe('comparisons', () => {
  it.each(COMPARISONS.map((c) => [c.id, c] as const))('%s compares real services, in plain words, with an AWS source', (_id, c) => {
    expect(c.options.length).toBeGreaterThanOrEqual(2);
    for (const o of c.options) {
      expect(ids.has(o.serviceId), o.serviceId).toBe(true);
      expect(o.pick).toMatch(/^Pick it /);
      expect(o.pick.length, o.serviceId).toBeLessThanOrEqual(120);
    }
    expect(c.simple.length).toBeLessThanOrEqual(120);
    expect(c.simple).not.toMatch(/—/);
    // Every row says something for every option.
    for (const r of c.rows) for (const o of c.options) expect(r.values[o.serviceId], `${c.id} ${r.label} ${o.serviceId}`).toBeTruthy();
    expect(c.source).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
  });

  it('unique ids, and each card is reachable from every service it compares', () => {
    expect(new Set(COMPARISONS.map((c) => c.id)).size).toBe(COMPARISONS.length);
    for (const c of COMPARISONS) for (const o of c.options) expect(comparisonsFor(o.serviceId)).toContain(c);
  });
});
