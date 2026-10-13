import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CityFinding } from '@/backend/contract';
import { demoFindings } from '@/backend/mockAccount';
import { bus } from '@/state/bus';
import { DRIP_MS, heldFindingIds, MAX_OPEN_FINDINGS, openFindings, severityRank, useCity } from '@/state/store';
import { SERVICES } from '@/world/taxonomy';
import { landmarkOf } from '@/state/cities';

const s = () => useCity.getState();
const send = (finding: CityFinding) => s().applyServerEvent({ type: 'city.finding', finding });
const shown = () => openFindings(s().findings).map((f) => f.id);
/** Five distinct findings with mixed severities (the demo account's, cycled with fresh ids). */
const findings = (n: number): CityFinding[] => {
  const base = demoFindings();
  const sev: CityFinding['severity'][] = ['high', 'medium', 'low', 'high', 'medium', 'low'];
  return Array.from({ length: n }, (_, i) => ({ ...base[i % base.length], id: `f${i}`, severity: sev[i % sev.length] }));
};

beforeEach(() => {
  vi.useFakeTimers();
  s().resetSession();
  s().clearToasts();
});
afterEach(() => {
  s().resetSession();
  useCity.setState({ backendKind: 'mock' });
  vi.useRealTimers();
});

describe('findings wait until city care unlocks', () => {
  it('holds new findings out of sight (so Explain and Fix can’t reach them)', () => {
    const [f] = findings(1);
    send(f);
    expect(s().findings).toEqual({});
    expect(heldFindingIds()).toEqual([f.id]);
    expect(s().careReleased).toBe(false);
  });

  it('a held finding that resolves is never shown', () => {
    const [f] = findings(1);
    send(f);
    send({ ...f, status: 'resolved' });
    expect(heldFindingIds()).toEqual([]);
    s().releaseCare();
    expect(s().findings).toEqual({});
  });

  it('drips them in lowest severity first, the next once the last is opened or 90 s pass, at most 3 open', async () => {
    const fs = findings(5);
    fs.forEach(send);
    s().releaseCare();
    expect(shown()).toHaveLength(1);
    expect(s().findings[shown()[0]].severity).toBe('low');
    // Opening its card lets the next one in.
    s().openFinding(shown()[0]);
    expect(shown()).toHaveLength(2);
    // Or 90 s pass.
    await vi.advanceTimersByTimeAsync(DRIP_MS - 1);
    expect(shown()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(shown()).toHaveLength(MAX_OPEN_FINDINGS);
    // Severity order held: low, low?, medium…
    const order = Object.values(s().findings).sort((a, b) => a.seenAt - b.seenAt).map((f) => severityRank(f.severity));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Full: nothing more while three are open.
    await vi.advanceTimersByTimeAsync(DRIP_MS * 3);
    expect(shown()).toHaveLength(MAX_OPEN_FINDINGS);
    expect(heldFindingIds()).toHaveLength(2);
    // One resolves: room for the next.
    const first = s().findings[shown()[0]];
    send({ ...first, status: 'resolved' });
    await vi.advanceTimersByTimeAsync(DRIP_MS);
    expect(shown()).toHaveLength(MAX_OPEN_FINDINGS);
    expect(heldFindingIds()).toHaveLength(1);
  });

  it('a finding already shown updates straight away', () => {
    const [f] = findings(1);
    send(f);
    s().releaseCare();
    send({ ...f, status: 'resolved' });
    expect(s().findings[f.id].status).toBe('resolved');
  });

  it('a linked account sees its findings at once', () => {
    const fs = findings(4);
    send(fs[0]);
    send(fs[1]);
    useCity.setState({ account: { linked: true }, backendKind: 'server' });
    s().releaseCare();
    expect(shown()).toHaveLength(2);
    send(fs[2]);
    send(fs[3]);
    expect(shown()).toHaveLength(4);
  });

  it('linking later shows everything still held', () => {
    useCity.setState({ backendKind: 'server' });
    findings(5).forEach(send);
    s().releaseCare();
    expect(shown()).toHaveLength(1);
    s().applyServerEvent({ type: 'account.status', linked: true, accountId: '123456789012', region: 'us-west-2' });
    expect(shown()).toHaveLength(5);
  });

  it('the demo’s practice account still drips (one at a time, never all at once)', () => {
    findings(5).forEach(send);
    s().releaseCare();
    expect(shown()).toHaveLength(1);
    s().applyServerEvent({ type: 'account.status', linked: true, accountId: '123456789012', region: 'us-west-2' });
    expect(shown()).toHaveLength(1);
    send(findings(6)[5]);
    expect(shown()).toHaveLength(1);
    expect(s().toasts.at(-1)?.text).toMatch(/practice account is linked/);
  });

  it('releaseCare({ all }) shows everything held at once (dev and smoke)', () => {
    findings(5).forEach(send);
    s().releaseCare({ all: true });
    expect(shown()).toHaveLength(5);
    expect(heldFindingIds()).toEqual([]);
  });

  it('forgets held findings when the session ends', () => {
    findings(2).forEach(send);
    s().resetSession();
    expect(heldFindingIds()).toEqual([]);
    expect(s().careReleased).toBe(false);
    s().releaseCare();
    expect(s().findings).toEqual({});
  });
});

describe('quiet discovery', () => {
  it('a finding builds its landmark without a toast or a camera move', async () => {
    const [f] = findings(1);
    expect(SERVICES.some((x) => x.id === f.serviceId)).toBe(true);
    const seen: { serviceId: string; quiet?: boolean }[] = [];
    const off = bus.on('discovered', (e) => seen.push(e));
    try {
      send(f);
      s().releaseCare();
      expect(landmarkOf(s().progress, f.serviceId)?.discovered).toBe(true);
      expect(seen).toEqual([{ serviceId: f.serviceId, quiet: true }]);
      expect(s().toasts).toEqual([]);
    } finally {
      off();
    }
  });

  it('XP builds quietly; visiting a page still announces it', () => {
    const [a, b] = SERVICES;
    const seen: { serviceId: string; quiet?: boolean }[] = [];
    const off = bus.on('discovered', (e) => seen.push(e));
    try {
      s().addXp(a.id, 3);
      expect(s().toasts).toEqual([]);
      s().discover(b.id);
      expect(s().toasts).toHaveLength(1);
      expect(seen).toEqual([
        { serviceId: a.id, quiet: true },
        { serviceId: b.id, quiet: false },
      ]);
    } finally {
      off();
    }
  });
});
