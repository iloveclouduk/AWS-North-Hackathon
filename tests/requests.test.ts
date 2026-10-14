import { describe, expect, it } from 'vitest';
import type { Progress } from '@/backend/contract';
import { countRequest, pickRequest, REQUESTS_A_DAY, requestsLeft } from '@/state/requests';
import { cardsFor } from '@/world/content';

const city = (ids: string[], cards: Progress['cards'] = {}): Progress => ({
  version: 1,
  landmarks: {},
  cities: { 'us-west-2': { landmarks: Object.fromEntries(ids.map((id) => [id, { discovered: true, xp: 10 }])) } },
  cards,
  updatedAt: '2026-10-13T00:00:00Z',
});

describe('citizen requests (src/state/requests.ts)', () => {
  it('asks nothing in a city with no buildings yet', () => {
    expect(pickRequest(city([]), 'us-west-2', 1)).toBeUndefined();
  });

  it('asks about a building that stands in this city, with three different answers and one right', () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = pickRequest(city(['s3', 'lambda', 'ec2']), 'us-west-2', seed)!;
      expect(['s3', 'lambda', 'ec2']).toContain(r.serviceId);
      expect(cardsFor(r.serviceId).some((c) => c.id === r.cardId)).toBe(true);
      expect(new Set(r.options).size).toBe(3);
      const card = cardsFor(r.serviceId).find((c) => c.id === r.cardId)!;
      expect(r.options[r.right]).toBe(card.simple ?? card.a);
    }
  });

  it('never asks about another city’s buildings', () => {
    const r = pickRequest(city(['s3', 'lambda']), 'eu-west-2', 3);
    expect(r).toBeUndefined();
  });

  it('prefers cards that are due over ones reviewed recently', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    const later = now + 30 * 86_400_000;
    // every S3 card reviewed and not due; Lambda's never seen
    const cards = Object.fromEntries(cardsFor('s3').map((c) => [c.id, { due: later, interval: 30, ease: 2.5, reps: 3 }]));
    for (let seed = 0; seed < 10; seed++) expect(pickRequest(city(['s3', 'lambda'], cards), 'us-west-2', seed, now)!.serviceId).toBe('lambda');
  });

  it(`stops after ${REQUESTS_A_DAY} a day, and starts again the next day`, () => {
    let log;
    for (let i = 0; i < REQUESTS_A_DAY; i++) log = countRequest(log, '2026-10-13');
    expect(requestsLeft(log, '2026-10-13')).toBe(0);
    expect(requestsLeft(log, '2026-10-14')).toBe(REQUESTS_A_DAY);
  });
});
