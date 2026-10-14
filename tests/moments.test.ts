import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwsIncident } from '@/backend/contract';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import { QUESTS } from '@/world/content';
import { TIER_XP } from '@/world/places';

// One moment, one celebration: a big event gets one channel, never a toast stacked on the city's own celebration.
const s = () => useCity.getState();

beforeEach(() => {
  vi.useFakeTimers();
  s().resetSession();
  s().clearToasts();
});
afterEach(() => {
  s().resetSession();
  vi.useRealTimers();
});

describe('moments', () => {
  it('a tier-up celebrates on the building only (no toast)', () => {
    const tierUps: unknown[] = [];
    const off = bus.on('tierUp', (e) => tierUps.push(e));
    s().addXp('s3', TIER_XP[1]);
    off();
    expect(tierUps).toHaveLength(1);
    expect(s().toasts).toHaveLength(0);
  });

  it('a finished quest opens its celebration card instead of a toast', () => {
    const q = QUESTS[0];
    s().startQuest(q.id);
    // Walk every step (a cards step counts one card at a time).
    for (const step of q.steps) {
      const n = step.kind === 'cards' ? step.count : 1;
      for (let i = 0; i < n; i++) s().questEvent((st) => st === step, true);
    }
    expect(s().progress.quests?.[q.id]?.status).toBe('done');
    expect(s().celebration).toBe(q.id);
    expect(s().toasts.some((t) => /Quest complete/.test(t.text))).toBe(false);
    s().celebrate(undefined);
    expect(s().celebration).toBeUndefined();
  });

  it('a deploy that finishes a quest celebrates once (no "built" toast on top of the card)', () => {
    const q = QUESTS.find((x) => x.steps.at(-1)?.kind === 'deploy')!;
    const last = q.steps.at(-1)!;
    s().startQuest(q.id);
    for (const step of q.steps.slice(0, -1)) {
      const n = step.kind === 'cards' ? step.count : 1;
      for (let i = 0; i < n; i++) s().questEvent((st) => st === step, true);
    }
    s().clearToasts();
    const templateId = (last as { templateId: string }).templateId;
    useCity.setState({ deploys: { d1: { deployId: 'd1', templateId, stackName: 'aws-city-static-site', region: 'us-west-2', changes: [], status: 'running' } } } as never);
    s().applyServerEvent({ type: 'deploy.status', deployId: 'd1', status: 'complete' } as never);
    expect(s().celebration).toBe(q.id);
    expect(s().toasts).toHaveLength(0);
    // Not a quest's last step: the toast says where it was built (the demo's practice account).
    useCity.setState({ deploys: { d2: { deployId: 'd2', templateId, stackName: 'again', region: 'us-west-2', changes: [], status: 'running' } } } as never);
    s().applyServerEvent({ type: 'deploy.status', deployId: 'd2', status: 'complete' } as never);
    expect(s().toasts.at(-1)?.text).toBe('again is built in the practice account!');
  });

  it('a deploy finishing never ticks an "ask" step (only an answered request does)', () => {
    const q = QUESTS.find((x) => x.steps.some((st) => st.kind === 'ask'))!;
    const at = q.steps.findIndex((st) => st.kind === 'ask');
    s().startQuest(q.id);
    for (const step of q.steps.slice(0, at)) {
      const n = step.kind === 'cards' ? step.count : 1;
      for (let i = 0; i < n; i++) s().questEvent((st) => st === step, true);
    }
    expect(s().progress.quests?.[q.id]?.step).toBe(at);
    useCity.setState({ deploys: { d9: { deployId: 'd9', templateId: 'static-site', stackName: 'x', region: 'us-west-2', changes: [], status: 'running' } } } as never);
    s().applyServerEvent({ type: 'task.done', taskId: 'd9', ok: true, result: 'deployed', xp: [] });
    expect(s().progress.quests?.[q.id]?.step).toBe(at);
    s().applyServerEvent({ type: 'task.done', taskId: 't1', ok: true, result: 'answered', xp: [] });
    expect(s().progress.quests?.[q.id]?.step).toBe(at + 1);
  });

  it('AWS Health stays quiet (weather only, no toast) before the first quest is done', () => {
    const incident = (status: AwsIncident['status']): AwsIncident => ({
      id: 'i1',
      title: 'Practice drill: S3 in us-west-2',
      region: s().cityRegion,
      services: ['s3'],
      severity: 'degradation',
      status,
      drill: true,
      started: new Date().toISOString(),
      updated: new Date().toISOString(),
      log: [],
    } as unknown as AwsIncident);
    s().applyServerEvent({ type: 'aws.health', incidents: [], asOf: new Date().toISOString() } as never);
    s().applyServerEvent({ type: 'aws.health', incidents: [incident('open')], asOf: new Date().toISOString() } as never);
    expect(s().toasts).toHaveLength(0);
  });

  it('players see stars, never "XP" (outside comments and identifiers)', () => {
    const files = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|tsx|json)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const root = path.resolve(__dirname, '..');
    const hits = [...files(path.join(root, 'src')), ...files(path.join(root, 'shared'))].flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .map((line, n) => ({ at: `${path.relative(root, f)}:${n + 1}`, line }))
        .filter(({ line }) => /\bXP\b/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)),
    );
    expect(hits.map((h) => h.at)).toEqual([]);
  });
});
