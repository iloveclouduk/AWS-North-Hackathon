import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectionLabel, DEMO_KEY, placeSuggestions, isAccountIdOrRoleArn, isDemo, setDemo, isOnline, newlyUnlocked, nextTabIndex, offlineReason, shuffle, unlockText } from '@/ui/logic';
import type { Progress } from '@/backend/contract';
import { badgeCount, dueDeck, NEW_CARDS_PER_DAY, newCardsLeft } from '@/state/srs';
import { CARDS, QUESTS, type QuestStep } from '@/world/content';
import { errorText, useCity } from '@/state/store';

describe('tab keyboard nav (roving tabindex)', () => {
  it('wraps Left/Right and jumps with Home/End', () => {
    expect(nextTabIndex('ArrowRight', 0, 7)).toBe(1);
    expect(nextTabIndex('ArrowRight', 6, 7)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 7)).toBe(6);
    expect(nextTabIndex('Home', 4, 7)).toBe(0);
    expect(nextTabIndex('End', 1, 7)).toBe(6);
  });
  it('ignores other keys and empty lists', () => {
    expect(nextTabIndex('Enter', 2, 7)).toBeUndefined();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeUndefined();
  });
});

describe('connection pill', () => {
  it('says readable things per state', () => {
    expect(connectionLabel('mock', 'connected')).toBe('Demo mode');
    expect(connectionLabel('server', 'connected')).toBe('Connected');
    expect(connectionLabel('server', 'connecting')).toBe('Connecting…');
    expect(connectionLabel('server', 'connecting', true)).toBe('Reconnecting…');
    expect(connectionLabel('server', 'disconnected')).toBe('Offline');
    expect(connectionLabel('server', 'error')).toBe('Offline');
    expect(connectionLabel('server', 'signed-out')).toBe('Signed out');
  });
  it('blocks actions only when a real backend is not connected', () => {
    expect(isOnline('mock', 'disconnected')).toBe(true);
    expect(isOnline('server', 'connected')).toBe(true);
    expect(isOnline('server', 'error')).toBe(false);
    expect(offlineReason('server', 'connected')).toBeUndefined();
    expect(offlineReason('server', 'signed-out')).toMatch(/sign in/i);
    expect(offlineReason('server', 'disconnected')).toMatch(/not connected/i);
  });
});

describe('error codes → friendly text', () => {
  it('maps known codes and falls back to the message', () => {
    expect(errorText({ message: 'x', code: 'quota' } as { message: string })).toBe('You’ve used today’s AI helpers — back tomorrow!');
    expect(errorText({ message: 'x', code: 'auth' } as { message: string })).toBe('Please sign in again');
    expect(errorText({ message: 'x', code: 'unlinked' } as { message: string })).toBe('Connect your AWS account in the Build tab');
    expect(errorText({ message: 'raw', code: 'nope' } as { message: string })).toBe('raw');
    expect(errorText({ message: 'raw' })).toBe('raw');
  });
  it('an error event raises an error toast and lands in the HQ chat', () => {
    useCity.setState({ view: { name: 'interior', districtId: 'storage' }, chats: {}, toasts: [] });
    useCity.getState().applyServerEvent({ type: 'error', message: 'boom', code: 'quota' } as never);
    const s = useCity.getState();
    expect(s.toasts.at(-1)).toMatchObject({ kind: 'error', text: 'You’ve used today’s AI helpers — back tomorrow!' });
    expect(s.chats.storage?.at(-1)).toMatchObject({ role: 'error', text: 'You’ve used today’s AI helpers — back tomorrow!' });
  });
});

describe('small helpers', () => {
  it('shuffle is a permutation and uses the rng', () => {
    const xs = [1, 2, 3, 4, 5];
    const out = shuffle(xs, () => 0);
    expect([...out].sort()).toEqual(xs);
    expect(out).not.toEqual(xs);
    expect(xs).toEqual([1, 2, 3, 4, 5]); // not mutated
  });
  it('accepts an account id or a role ARN', () => {
    expect(isAccountIdOrRoleArn('123456789012')).toBe(true);
    expect(isAccountIdOrRoleArn(' arn:aws:iam::123456789012:role/aws-city-player ')).toBe(true);
    expect(isAccountIdOrRoleArn('12345')).toBe(false);
    expect(isAccountIdOrRoleArn('arn:aws:s3:::bucket')).toBe(false);
  });
});

describe('starting a quest where you already stand', () => {
  it('counts the first visit step straight away', () => {
    const s = useCity.getState();
    s.setFocus({ url: 'https://us-west-2.console.aws.amazon.com/s3/home', title: 'S3', kind: 'console', serviceId: 's3' });
    s.startQuest('storage-static-site');
    expect(useCity.getState().progress.quests?.['storage-static-site']).toMatchObject({ status: 'active', step: 1 });
  });
});

describe('pending buttons and backend errors', () => {
  it('an error settles only the button that sent that request; an error with no id settles none', async () => {
    const { keyForError } = await import('@/ui/usePending');
    const ids = new Map([
      ['req-link', 'link'],
      ['req-plan', 'plan:library'],
    ]);
    expect(keyForError({ requestId: 'req-plan' }, ids)).toBe('plan:library');
    expect(keyForError({ taskId: 'req-link' }, ids)).toBe('link');
    expect(keyForError({ requestId: 'someone-else' }, ids)).toBeUndefined();
    expect(keyForError({}, ids)).toBeUndefined();
  });

  it('an error with no id settles Approve on mfa_required, else only what was just pressed', async () => {
    const { keysForError, RECENT_MS } = await import('@/ui/usePending');
    const ids = new Map([['req-plan', 'plan:library']]);
    const now = 100_000;
    const startedAt = new Map([
      ['plan:library', now - RECENT_MS - 1],
      ['decide:d-1', now - 60_000],
      ['teardown:d-2', now - 1_000],
    ]);
    // deploy.approve's step-up refusal carries no id: every Approve spinner stops, nothing else.
    expect(keysForError({ code: 'mfa_required' }, ids, startedAt, now)).toEqual(['decide:d-1']);
    // A rate limit (no id) answers the click just made; an older spinner keeps waiting for its own answer.
    expect(keysForError({}, ids, startedAt, now)).toEqual(['teardown:d-2']);
    // With an id, only that request's button.
    expect(keysForError({ requestId: 'req-plan', code: 'mfa_required' }, ids, startedAt, now)).toEqual(['plan:library']);
    expect(keysForError({ requestId: 'someone-else' }, ids, startedAt, now)).toEqual([]);
  });
});

describe('the demo pref', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('turns on and off through localStorage, and is off when storage is unavailable', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) });
    expect(isDemo()).toBe(false);
    setDemo(true);
    expect(data.get(DEMO_KEY)).toBe('1');
    expect(isDemo()).toBe(true);
    setDemo(false);
    expect(data.has(DEMO_KEY)).toBe(false);
    expect(isDemo()).toBe(false);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } });
    expect(() => setDemo(true)).not.toThrow();
    expect(isDemo()).toBe(false);
  });
});

describe('the unlock ladder in the tab bar', () => {
  it('arrow keys move over the tabs that are showing, not the locked ones', () => {
    const shown = ['home', 'quests', 'deploy'];
    expect(shown[nextTabIndex('ArrowRight', 1, shown.length)!]).toBe('deploy');
    expect(shown[nextTabIndex('ArrowRight', 2, shown.length)!]).toBe('home');
    expect(shown[nextTabIndex('End', 0, shown.length)!]).toBe('deploy');
  });

  it('toasts a tab once: only when it newly appears and its toast has not shown', () => {
    const prev = new Set(['home', 'quests']);
    expect(newlyUnlocked(prev, new Set(['home', 'quests', 'learn', 'map']), new Set())).toEqual(['learn', 'map']);
    expect(newlyUnlocked(prev, new Set(['home', 'quests', 'learn']), new Set(['learn']))).toEqual([]);
    expect(newlyUnlocked(new Set(['home', 'learn']), new Set(['home']), new Set())).toEqual([]);
    expect(unlockText(['Learn'])).toMatch(/^New: Learn is open/);
    expect(unlockText(['Learn', 'Places', 'Deploy'])).toMatch(/^New: Learn, Places and Deploy are open/);
  });
});

describe('the Learn badge', () => {
  const base: Progress = { version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00.000Z' };
  const NOW = 1_800_000_000_000;
  const cardsQuest = QUESTS.find((q) => q.steps.some((s) => s.kind === 'cards'))!;
  const cardsAt = cardsQuest.steps.findIndex((s) => s.kind === 'cards');
  const cardsStep = cardsQuest.steps[cardsAt] as Extract<QuestStep, { kind: 'cards' }>;

  it('counts reviewed cards that are due, never new ones', () => {
    expect(badgeCount(base, NOW)).toBe(0);
    const cards = {
      'a-1': { interval: 1, ease: 2.5, due: NOW - 1, reps: 1 },
      'a-2': { interval: 3, ease: 2.5, due: NOW + 86_400_000, reps: 2 },
    };
    expect(badgeCount({ ...base, cards }, NOW)).toBe(1);
  });

  it("adds what the active quest's cards step still needs", () => {
    const quests = { [cardsQuest.id]: { status: 'active' as const, step: cardsAt, count: 1 } };
    expect(badgeCount({ ...base, quests }, NOW)).toBe(Math.max(0, cardsStep.count - 1));
    expect(badgeCount({ ...base, quests: { [cardsQuest.id]: { status: 'done' as const, step: cardsQuest.steps.length } } }, NOW)).toBe(0);
  });

  it('the Due deck takes reviewed cards first, then at most 10 new cards a day', () => {
    const ids = Object.keys(CARDS).filter((id) => CARDS[id].length > 0);
    const all = ids.flatMap((id) => CARDS[id]);
    expect(all.length).toBeGreaterThan(NEW_CARDS_PER_DAY);
    const seen = all[all.length - 1];
    const p = { ...base, cards: { [seen.id]: { interval: 1, ease: 2.5, due: NOW - 1, reps: 1 } } };
    const deck = dueDeck(p, ids, newCardsLeft(undefined, '2026-10-11'), NOW);
    expect(deck[0].id).toBe(seen.id);
    expect(deck).toHaveLength(1 + NEW_CARDS_PER_DAY);
    expect(newCardsLeft({ day: '2026-10-11', n: 4 }, '2026-10-11')).toBe(6);
    expect(newCardsLeft({ day: '2026-10-10', n: 40 }, '2026-10-11')).toBe(NEW_CARDS_PER_DAY);
    expect(dueDeck(p, ids, 0, NOW).map((c) => c.id)).toEqual([seen.id]);
  });
});

describe('the Places tab with nothing picked', () => {
  const at = (landmarks: Record<string, { discovered: boolean; xp: number }>): Progress => ({
    version: 1,
    landmarks: {},
    cities: { 'us-west-2': { landmarks } },
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('suggests the top building, the one nearest a level-up, and one not built yet', () => {
    const got = placeSuggestions(at({ s3: { discovered: true, xp: 120 }, lambda: { discovered: true, xp: 35 }, ec2: { discovered: true, xp: 2 } }), 'us-west-2');
    expect(got.map((g) => g.kind)).toEqual(['top', 'close', 'new']);
    expect(got[0].serviceId).toBe('s3');
    // lambda needs 5 more for Practitioner (40), ec2 needs 8 for Novice (10): lambda is closer.
    expect(got[1]).toEqual({ kind: 'close', serviceId: 'lambda', toGo: 5 });
    expect(['s3', 'lambda', 'ec2']).not.toContain(got[2].serviceId);
  });

  it('a new city offers only a place to build first', () => {
    expect(placeSuggestions(at({}), 'us-west-2').map((g) => g.kind)).toEqual(['new']);
  });
});

describe("Today's goals on Home", () => {
  it('show only for open areas, count today only, and cap at the goal', async () => {
    const { todayGoals } = await import('@/state/progress');
    const open = { learn: true, puzzles: false, care: true };
    expect(todayGoals(undefined, '2026-10-12', open).map((g) => g.id)).toEqual(['cards', 'fixes']);
    const log = { day: '2026-10-12', cards: 9, puzzles: 1, fixes: 0 };
    const g = todayGoals(log, '2026-10-12', { learn: true, puzzles: true, care: false });
    expect(g.map((x) => [x.id, x.have, x.goal])).toEqual([['cards', 5, 5], ['puzzles', 1, 1]]);
    // Yesterday's log doesn't count today.
    expect(todayGoals(log, '2026-10-13', open)[0].have).toBe(0);
    expect(todayGoals(undefined, '2026-10-12', { learn: false, puzzles: false, care: false })).toEqual([]);
    // a mini-game goal once a game building stands in the city (old logs have no games count)
    const games = todayGoals(log, '2026-10-12', { learn: false, puzzles: false, care: false, games: true });
    expect(games.map((x) => [x.id, x.have, x.goal])).toEqual([['games', 0, 1]]);
    expect(todayGoals({ ...log, games: 2 }, '2026-10-12', { learn: false, puzzles: false, care: false, games: true })[0].have).toBe(1);
  });
});

describe('the city postcard', () => {
  it('says where and how far you got, and gets a file name you can find again', async () => {
    const { postcardCaption, postcardName } = await import('@/game/postcard');
    expect(postcardCaption('Tokyo', 'ap-northeast-1', 2547, 'Red and white lattice tower')).toBe('My AWS City · Tokyo (ap-northeast-1) · ⭐ 2,547 · Red and white lattice tower');
    expect(postcardName('N. California', new Date('2026-10-12T09:00:00Z'))).toBe('aws-city-n-california-2026-10-12.png');
    expect(postcardName('São Paulo', new Date('2026-10-12T09:00:00Z'))).toBe('aws-city-sao-paulo-2026-10-12.png');
  });
});

describe('citySummary', () => {
  it('says the Region, the buildings, the issues and what is on, in one line', async () => {
    const { citySummary } = await import('@/ui/logic');
    const { emptyProgress } = await import('@/state/store');
    const line = citySummary({ cityRegion: 'us-west-2', regionName: 'US West (Oregon)', progress: emptyProgress(), openIssues: 2, outage: true, flowOn: true });
    expect(line).toMatch(/^US West \(Oregon\): 0 of \d+ buildings, 2 issues to fix, AWS reports a problem in this Region, live traffic on\. Press \]/);
    expect(citySummary({ cityRegion: 'eu-west-1', progress: emptyProgress(), openIssues: 1 })).toContain('1 issue to fix');
    expect(citySummary({ cityRegion: 'eu-west-1', progress: emptyProgress(), openIssues: 0 })).toContain('no issues');
  });
});

describe('dueFor', () => {
  it("counts one service's reviewed cards that are due, not new ones", async () => {
    const { dueFor } = await import('@/state/srs');
    const { emptyProgress } = await import('@/state/store');
    const { cardsFor } = await import('@/world/content');
    const [a, b, c] = cardsFor('s3');
    const p = emptyProgress();
    const now = Date.parse('2026-10-12T12:00:00Z');
    p.cards = { [a.id]: { interval: 1, ease: 2.5, due: now - 1000, reps: 1 }, [b.id]: { interval: 1, ease: 2.5, due: now + 86_400_000, reps: 1 } };
    expect(dueFor(p, 's3', now)).toBe(1);
    expect(dueFor(p, 'lambda', now)).toBe(0);
    expect(c).toBeTruthy();
  });
});
