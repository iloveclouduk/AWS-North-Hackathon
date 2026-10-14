import { describe, expect, it } from 'vitest';
import { deal, DNS_QUESTIONS, FISH, SHIELD, tierFor } from '@/world/minigames';
import { addServer, arrivals, demandAt, newRush, phaseAt, removeServer, RUSH, RUSH_LESSON, rushStars, rushVerdict, serverCount, tick } from '@/game/scenes/games/rushHour';
import { drain, isHot, KEYS, nextParcel, send, shelfFor, SHELVES, SORT, SORT_LESSON, sortPoints, sortStars } from '@/game/scenes/games/sorting';
import { PLACES } from '@/world/places';

describe('mini-game pools (shared/minigames.json)', () => {
  it('are big enough not to repeat after one play, with every tier filled', () => {
    for (const pool of [FISH, DNS_QUESTIONS]) {
      expect(pool.length).toBeGreaterThanOrEqual(30);
      for (const t of [1, 2, 3]) expect(pool.filter((x) => x.tier === t).length, `tier ${t}`).toBeGreaterThanOrEqual(8);
    }
    expect(SHIELD.attacks.length).toBeGreaterThanOrEqual(15);
    expect(SHIELD.good.length).toBeGreaterThanOrEqual(10);
  });

  it('every item is well-formed: a real answer, a reason, no duplicates', () => {
    for (const f of FISH) {
      expect(['standard', 'ia', 'glacier']).toContain(f.answer);
      expect(f.why.length, f.name).toBeGreaterThan(15);
    }
    expect(new Set(FISH.map((f) => f.name)).size).toBe(FISH.length);
    for (const q of DNS_QUESTIONS) {
      expect(q.options, q.q).toContain(q.answer);
      expect(new Set(q.options).size, q.q).toBe(q.options.length);
      expect(q.options.length, q.q).toBe(4);
      expect(q.why.length, q.q).toBeGreaterThan(15);
    }
    expect(new Set(DNS_QUESTIONS.map((q) => q.q)).size).toBe(DNS_QUESTIONS.length);
    for (const a of SHIELD.attacks) expect(SHIELD.rules[a.rule], a.label).toBeTruthy();
    // A real user's request must never look like an attack's label.
    for (const g of SHIELD.good) expect(SHIELD.attacks.some((a) => a.label === g)).toBe(false);
  });

  it('deals a round from the tiers reached, at least half from the top one, never repeating', () => {
    expect([0, 1, 2, 4, 5, 20].map(tierFor)).toEqual([1, 1, 2, 2, 3, 3]);
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const plays of [0, 3, 9]) {
      const round = deal(DNS_QUESTIONS, plays, 8, rand);
      expect(round).toHaveLength(8);
      expect(new Set(round).size).toBe(8);
      const top = tierFor(plays);
      expect(round.every((q) => q.tier <= top)).toBe(true);
      expect(round.filter((q) => q.tier === top).length).toBeGreaterThanOrEqual(4);
    }
    expect(deal(FISH, 0, 5, rand).every((f) => f.tier === 1)).toBe(true);
  });
});

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe('EC2 Rush Hour rules', () => {
  /** Plays a whole day, keeping `want(t)` servers on. */
  const play = (want: (t: number) => number, rand = seeded()) => {
    const s = newRush();
    let points = 0;
    for (let t = 0; t < RUSH.seconds; t++) {
      while (serverCount(s) < want(t) && addServer(s));
      while (serverCount(s) > want(t) && removeServer(s));
      points += tick(s, arrivals(t, rand)).points;
    }
    return { s, points };
  };

  it('has a quiet morning, a lunch rush and a calm evening', () => {
    expect([0, 17, 18, 35, 36, 53].map(phaseAt)).toEqual(['morning', 'morning', 'lunch', 'lunch', 'evening', 'evening']);
    expect(Math.max(...[0, 5, 10, 17].map(demandAt))).toBeLessThan(Math.min(...[20, 27, 33].map(demandAt)));
    expect(demandAt(27)).toBeCloseTo(6);
    expect(Math.max(...[40, 45, 53].map(demandAt))).toBeLessThan(demandAt(27));
  });

  it('a new server boots before it serves; servers stay between the minimum and maximum', () => {
    const s = newRush();
    expect(removeServer(s)).toBe(false);
    addServer(s);
    expect(s.ready).toBe(1);
    tick(s, 0);
    expect(s.ready).toBe(1); // still starting
    tick(s, 0);
    expect(s.ready).toBe(2);
    while (addServer(s));
    expect(serverCount(s)).toBe(RUSH.maxServers);
  });

  it('serves the line, counts idle servers and long lines', () => {
    const s = newRush();
    s.ready = 3;
    expect(tick(s, 1)).toMatchObject({ served: 1, idle: 2, long: false, points: 1 - 2 });
    s.ready = 1;
    const r = tick(s, RUSH.longQueue + 1);
    expect(r.long).toBe(true);
    expect(s.queue).toBe(RUSH.longQueue);
    expect(s.stats).toMatchObject({ served: 2, idleS: 2, longQueueS: 1 });
  });

  it('three stars for scaling with the crowd; too many servers or too few lose a star', () => {
    // A player who checks every five seconds and scales a little ahead of the crowd.
    for (const seed of [1, 7, 42]) {
      const good = play((t) => Math.ceil(demandAt(t - (t % 5) + 4)), seeded(seed));
      expect(rushStars(good.s.stats), `seed ${seed}`).toBe(3);
      expect(rushVerdict(good.s.stats)).toBe('Perfect scaling!');
    }
    const always8 = play(() => RUSH.maxServers);
    expect(always8.s.stats.longQueueS).toBe(0);
    expect(rushStars(always8.s.stats)).toBe(2);
    expect(rushVerdict(always8.s.stats)).toMatch(/idle/);
    const always1 = play(() => 1);
    expect(always1.s.stats.idleS).toBe(0);
    expect(rushStars(always1.s.stats)).toBe(2);
    expect(rushVerdict(always1.s.stats)).toMatch(/long/);
    expect(play((t) => Math.ceil(demandAt(t - (t % 5) + 4))).points).toBeGreaterThan(Math.max(always8.points, always1.points));
  });

  it('ends on the Auto Scaling lesson', () => {
    expect(RUSH_LESSON).toMatch(/adds servers when it’s busy and removes them when it’s quiet/);
  });
});

describe('DynamoDB Sorting Office rules', () => {
  it('every key lives on exactly one shelf, and the same key always goes to the same shelf', () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
    for (const key of KEYS) {
      expect(SHELVES.filter((s) => s.includes(key))).toHaveLength(1);
      expect(shelfFor({ key })).toBe(shelfFor({ key }));
    }
    expect(KEYS).toContain(SORT.hotKey);
    // A spread key carries its shelf number.
    expect([1, 2, 3, 4].map((part) => shelfFor({ key: SORT.hotKey, part }))).toEqual([0, 1, 2, 3]);
  });

  it('the hot moment floods one key onto one shelf until the keys are spread', () => {
    expect([SORT.hotFrom - 1, SORT.hotFrom, SORT.hotTo - 1, SORT.hotTo].map(isHot)).toEqual([false, true, true, false]);
    const rand = seeded(3);
    const shelfLoad = (spread: boolean) => {
      const n = [0, 0, 0, 0];
      for (let i = 0; i < 400; i++) n[shelfFor(nextParcel(SORT.hotFrom + 1, spread, rand))]++;
      return Math.max(...n) / 400;
    };
    expect(shelfLoad(false)).toBeGreaterThan(0.6);
    expect(shelfLoad(true)).toBeLessThan(0.4);
    // Outside the hot moment, keys are spread already and never carry a number.
    for (let i = 0; i < 100; i++) expect(nextParcel(2, false, rand).part).toBeUndefined();
  });

  it('a busy shelf throttles until it has put parcels away', () => {
    let loads = [0, 0, 0, 0];
    for (let i = 0; i < SORT.shelfCap; i++) expect(send(loads, 0)).toBe('ok');
    expect(send(loads, 0)).toBe('busy');
    expect(send(loads, 1)).toBe('ok'); // other shelves are fine
    loads = drain(loads, 1 / SORT.drainPerS);
    expect(send(loads, 0)).toBe('ok');
    expect(drain([0.1], 10)).toEqual([0]);
  });

  it('scores quick sorts higher; stars for spreading keys and careful sorting', () => {
    expect(sortPoints(500)).toBeGreaterThan(sortPoints(SORT.quickMs + 1));
    const base = { sorted: 30, wrong: 0, throttled: 0, dropped: 0, spread: true };
    expect(sortStars(base)).toBe(3);
    expect(sortStars({ ...base, spread: false })).toBe(2);
    expect(sortStars({ ...base, wrong: 5 })).toBe(2);
    expect(sortStars({ ...base, spread: false, dropped: 5 })).toBe(1);
    expect(SORT_LESSON).toMatch(/by their key/);
  });
});

describe('mini-game registration', () => {
  it('EC2 and DynamoDB landmarks are playable', () => {
    expect(PLACES.find((p) => p.serviceId === 'ec2')?.game).toBe('ec2');
    expect(PLACES.find((p) => p.serviceId === 'dynamodb')?.game).toBe('dynamodb');
  });
});
