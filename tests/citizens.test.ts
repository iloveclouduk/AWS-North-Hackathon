import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CityFinding, Progress } from '@/backend/contract';
import { demoFindings } from '@/backend/mockAccount';
import { bus } from '@/state/bus';
import { awardCitizens, citizenLevel, citizensForPuzzle, citizensForService, fixGate, LEVEL_XP, levelForXp, xpToNext } from '@/state/citizens';
import { mergeProgress, sameProgress } from '@/state/progress';
import { emptyProgress, useCity } from '@/state/store';
import { CITIZEN_LEVELS, CITIZENS } from '@/world/citizens';
import { landmarkOf } from '@/state/cities';

const p = (over: Partial<Progress> = {}): Progress => ({ version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00.000Z', ...over });
const finding = (ruleId: string): CityFinding => demoFindings().find((f) => f.ruleId === ruleId)!;

describe('citizen levels', () => {
  it('reads the thresholds from shared/citizens.json', () => {
    expect(LEVEL_XP).toEqual(CITIZEN_LEVELS.map((l) => l.xp));
    expect(LEVEL_XP).toEqual([0, 20, 60]);
  });

  it('Spotter → Fixer at 20 → Caretaker at 60', () => {
    expect([0, 19, 20, 59, 60, 500].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(xpToNext(12)).toBe(8);
    expect(xpToNext(60)).toBeUndefined();
  });

  it('awards XP and reports level-ups once', () => {
    const a = awardCitizens(p({ citizens: { 'citizen:security': { xp: 18 } } }), [{ citizenId: 'citizen:security', amount: 2 }]);
    expect(a.progress.citizens!['citizen:security'].xp).toBe(20);
    expect(a.levelUps).toEqual([{ citizenId: 'citizen:security', level: 2 }]);
    const b = awardCitizens(a.progress, [{ citizenId: 'citizen:security', amount: 1 }]);
    expect(b.levelUps).toEqual([]);
    // Unknown citizens and zero amounts change nothing.
    const base = p();
    expect(awardCitizens(base, [{ citizenId: 'citizen:nobody', amount: 5 }, { citizenId: 'citizen:cost', amount: 0 }]).progress).toBe(base);
  });

  it('flashcards teach the citizens of that service’s district; puzzles teach strong pillars', () => {
    const s3 = citizensForService('s3').map((c) => c.id).sort();
    expect(s3).toEqual(CITIZENS.filter((c) => c.districts.includes('storage')).map((c) => c.id).sort());
    expect(citizensForService('nope')).toEqual([]);
    expect(citizensForPuzzle({ security: 70, cost: 69, reliability: 100 }).map((c) => c.pillar).sort()).toEqual(['reliability', 'security']);
  });

  it('gates fixes by level and scope, and says how to teach', () => {
    const imds = finding('ec2-imdsv1');
    const game = { ...imds, fix: { ...imds.fix!, scope: 'game' as const } }; // security, as if the city had built it
    const account = finding('ec2-imdsv1'); // security, scope account
    const none = finding('lambda-old-runtime');
    const at = (xp: number) => p({ citizens: { 'citizen:security': { xp } } });
    const gate = fixGate(at(0), game);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toMatch(/^Teach Priya first\. To fix things the city built, Priya must be a Fixer/);
    expect(fixGate(at(20), game).ok).toBe(true);
    expect(fixGate(at(20), account).ok).toBe(false);
    expect(fixGate(at(60), account).ok).toBe(true);
    expect(fixGate(at(999), none).ok).toBe(false);
    // The demo's city-built fix is Noor's table.
    expect(fixGate(at(0), finding('dynamodb-no-pitr')).ok).toBe(false);
    expect(fixGate(p({ citizens: { 'citizen:reliability': { xp: 20 } } }), finding('dynamodb-no-pitr')).ok).toBe(true);
  });
});

describe('citizen progress merges like the rest', () => {
  it('higher XP and the newest fix time win, in either order', () => {
    const a = p({ citizens: { 'citizen:cost': { xp: 30 }, 'citizen:security': { xp: 5 } }, fixes: { f1: '2026-01-02T00:00:00.000Z' } });
    const b = p({ citizens: { 'citizen:cost': { xp: 12 }, 'citizen:reliability': { xp: 7 } }, fixes: { f1: '2026-01-03T00:00:00.000Z', f2: '2026-01-01T00:00:00.000Z' } });
    const m = mergeProgress(a, b);
    expect(m.citizens).toEqual({ 'citizen:cost': { xp: 30 }, 'citizen:security': { xp: 5 }, 'citizen:reliability': { xp: 7 } });
    expect(m.fixes).toEqual({ f1: '2026-01-03T00:00:00.000Z', f2: '2026-01-01T00:00:00.000Z' });
    expect(mergeProgress(b, a)).toEqual(m);
    expect(sameProgress(m, a)).toBe(true);
    expect(sameProgress(a, m)).toBe(false);
  });
});

describe('the store teaches citizens', () => {
  beforeEach(() => useCity.setState({ progress: emptyProgress(), findings: {}, deploys: {}, careRequests: {}, explanations: {} }));

  it('+1 per flashcard reviewed in a citizen’s district', () => {
    useCity.getState().reviewCard('s3-1', 'good');
    const xp = useCity.getState().progress.citizens ?? {};
    for (const c of citizensForService('s3')) expect(xp[c.id]?.xp).toBe(1);
    expect(xp['citizen:performance']).toBeUndefined(); // compute, networking, aiml
  });

  it('+5 per strong pillar when a puzzle passes with a better score', () => {
    const s = useCity.getState();
    s.recordPuzzle('pz', 80, true, { security: 90, cost: 40 });
    s.recordPuzzle('pz', 80, true, { security: 90, cost: 40 }); // same score again: no farming
    expect(useCity.getState().progress.citizens).toEqual({ 'citizen:security': { xp: 5 } });
  });

  it('+10 and a level-up when a finding resolves after the player’s fix', () => {
    const f = finding('dynamodb-no-pitr'); // reliability
    useCity.setState({ progress: { ...emptyProgress(), citizens: { 'citizen:reliability': { xp: 12 } } } });
    const ups: unknown[] = [];
    const resolved: unknown[] = [];
    const off = [bus.on('citizenLevelUp', (e) => ups.push(e)), bus.on('findingResolved', (e) => resolved.push(e.fixed))];
    const s = useCity.getState();
    s.releaseCare(); // city care unlocked: the finding shows (tests/finding-pacing.test.ts covers the wait)
    s.applyServerEvent({ type: 'city.finding', finding: f });
    s.noteCare(f.id, { kind: 'fix', requestId: 'r' });
    s.applyServerEvent({ type: 'deploy.preview', deployId: 'd1', templateId: f.fix!.fixId, stackName: f.resource.name, region: 'us-west-2', changes: [], findingId: f.id, rollback: f.fix!.rollback });
    expect(useCity.getState().deploys.d1).toMatchObject({ findingId: f.id, rollback: f.fix!.rollback });
    expect(useCity.getState().careRequests[f.id]).toBeUndefined();
    s.applyServerEvent({ type: 'deploy.status', deployId: 'd1', status: 'creating' });
    s.applyServerEvent({ type: 'deploy.status', deployId: 'd1', status: 'complete' });
    s.applyServerEvent({ type: 'city.finding', finding: { ...f, status: 'resolved' } });
    off.forEach((o) => o());
    const st = useCity.getState();
    expect(st.progress.citizens!['citizen:reliability'].xp).toBe(22);
    expect(citizenLevel(st.progress, 'citizen:reliability')).toBe(2);
    expect(st.progress.fixes?.[f.id]).toBeTruthy();
    expect(landmarkOf(st.progress, 'dynamodb')?.xp).toBeGreaterThanOrEqual(10);
    expect(ups).toEqual([{ citizenId: 'citizen:reliability', level: 2, reason: 'you approved a fix' }]);
    expect(resolved).toEqual([true]);
  });

  it('a finding resolving on its own gives no XP', () => {
    const f = finding('lambda-old-runtime');
    const s = useCity.getState();
    s.applyServerEvent({ type: 'city.finding', finding: f });
    s.applyServerEvent({ type: 'city.finding', finding: { ...f, status: 'resolved' } });
    expect(useCity.getState().progress.citizens).toBeUndefined();
    expect(useCity.getState().progress.fixes).toBeUndefined();
  });
});

describe('toasts stay calm', () => {
  it('shows one info toast at a time, merges discoveries, and lets errors through', async () => {
    vi.useFakeTimers();
    try {
      useCity.getState().clearToasts();
      const s = useCity.getState();
      s.toast('🏅', 'First');
      s.toast('🚧', 'x', 'info', { group: 'discover', item: 'S3 Lake' });
      s.toast('🚧', 'x', 'info', { group: 'discover', item: 'VPC Walled Garden' });
      s.toast('🚧', 'x', 'info', { group: 'discover', item: 'EC2 Factory' });
      expect(useCity.getState().toasts.map((t) => t.text)).toEqual(['First']);
      await vi.advanceTimersByTimeAsync(3500 + 200);
      expect(useCity.getState().toasts.filter((t) => !t.leaving).map((t) => t.text)).toEqual(['3 new landmarks: S3 Lake, VPC Walled Garden and EC2 Factory. Construction has started.']);
      useCity.getState().toast('⚠️', 'Broken', 'error');
      const live = useCity.getState().toasts.filter((t) => !t.leaving);
      expect(live.map((t) => t.kind)).toEqual(['error']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a level-up toast says what earned it', () => {
    useCity.setState({ toasts: [], progress: { ...emptyProgress(), citizens: { 'citizen:security': { xp: 19 } } } });
    useCity.getState().awardCitizens([{ citizenId: 'citizen:security', amount: 1, reason: 'you’ve reviewed 20 security flashcards' }]);
    expect(useCity.getState().feed.at(-1)?.text).toContain('Priya is now a Fixer: you’ve reviewed 20 security flashcards.');
  });
});
