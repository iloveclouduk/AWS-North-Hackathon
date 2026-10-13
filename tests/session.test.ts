import { describe, expect, it, vi } from 'vitest';
import { useCity } from '@/state/store';
import { landmarkOf } from '@/state/cities';

describe('sign-out and account linking state', () => {
  it('resetSession forgets the previous player: account link, ExternalId, deploys, chats and progress', () => {
    useCity.setState({
      account: { linked: false, linkUrl: 'https://console.aws.amazon.com/cloudformation/x', externalId: 'secret', mfaRequired: true },
      deploys: { d1: { deployId: 'd1', templateId: 't', stackName: 's', region: 'us-west-2', changes: [], status: 'preview' } },
      chats: { storage: [{ id: 'u-1', role: 'user', text: 'hi' }] },
      progress: { version: 1, landmarks: { s3: { discovered: true, xp: 40 } }, updatedAt: '2026-01-01T00:00:00Z' },
    });
    useCity.getState().resetSession();
    const s = useCity.getState();
    expect(s.account).toEqual({ linked: false });
    expect(s.deploys).toEqual({});
    expect(s.chats).toEqual({});
    expect(s.progress.landmarks).toEqual({});
  });

  it('resetSession clears the COE board and badges (they hold the previous player’s prompts and failures)', () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem });
    try {
      useCity.setState({ culture: { badges: ['b1'], coe: [{ when: 'x', what: 'my secret prompt' } as never] } });
      useCity.getState().resetSession();
      expect(useCity.getState().culture).toEqual({ badges: [], coe: [] });
      expect(removeItem).toHaveBeenCalledWith('aws-city-culture');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a failed verify is shown, and each reply bumps seq so a waiting button settles', () => {
    useCity.setState({ account: { linked: false }, toasts: [] });
    const fail = { type: 'account.status', linked: false, message: 'I couldn’t use the AWSCity role.' } as const;
    useCity.getState().applyServerEvent(fail);
    useCity.getState().applyServerEvent(fail);
    const s = useCity.getState();
    expect(s.account.message).toMatch(/AWSCity role/);
    expect(s.account.seq).toBe(2);
    expect(s.toasts.some((t) => t.kind === 'error')).toBe(true);
  });
});

describe('the bill (v2.5)', () => {
  const bill = { type: 'city.bill', month: '2026-10', currency: 'USD', total: 4.2, byService: { ec2: 4.2 }, byRegion: { 'us-west-2': 4.2 }, takenAt: '2026-10-10T00:00:00Z', estimated: true } as const;
  it('is off by default: a city.bill is dropped until the player turns it on, and turning it off forgets it', () => {
    useCity.getState().resetSession();
    expect(useCity.getState().billOn).toBe(false);
    useCity.getState().applyServerEvent(bill);
    expect(useCity.getState().bill).toBeUndefined();
    useCity.getState().setBill(true);
    expect(useCity.getState().progress.bill).toBe(true);
    useCity.getState().applyServerEvent(bill);
    expect(useCity.getState().bill).toEqual(bill);
    useCity.getState().setBill(false);
    expect(useCity.getState()).toMatchObject({ billOn: false, bill: undefined, progress: { bill: false } });
  });

  it('follows Progress.bill when another surface or the server changes it', () => {
    useCity.getState().resetSession();
    useCity.getState().loadProgress({ version: 1, landmarks: {}, bill: true, updatedAt: '2026-10-10T00:00:00Z' });
    expect(useCity.getState().billOn).toBe(true);
    useCity.getState().loadProgress({ version: 1, landmarks: {}, updatedAt: '2026-10-11T00:00:00Z' });
    expect(useCity.getState().billOn).toBe(false);
  });
});

describe('quests and puzzles', () => {
  it('"Go →" on a quest step for an undiscovered landmark builds it (no empty plot, deck opens)', () => {
    useCity.setState({ progress: { version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00Z', quests: { 'compute-first-function': { status: 'active', step: 0, count: 0 } } } });
    useCity.getState().select('lambda');
    const p = useCity.getState().progress;
    expect(landmarkOf(p, 'lambda')?.discovered).toBe(true);
    expect(p.quests?.['compute-first-function']?.step).toBe(1);
  });

  it('selecting a landmark no quest points at does not discover it', () => {
    useCity.setState({ progress: { version: 1, landmarks: {}, updatedAt: '2026-01-01T00:00:00Z' } });
    useCity.getState().select('ec2');
    expect(landmarkOf(useCity.getState().progress, 'ec2')).toBeUndefined();
  });
});
