import { describe, expect, it } from 'vitest';
import { connectionLabel, isAccountIdOrRoleArn, isOnline, nextTabIndex, offlineReason, shuffle } from '@/ui/logic';
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
    expect(connectionLabel('agentcore', 'signed-out')).toBe('Signed out');
  });
  it('blocks actions only when a real backend is not connected', () => {
    expect(isOnline('mock', 'disconnected')).toBe(true);
    expect(isOnline('server', 'connected')).toBe(true);
    expect(isOnline('server', 'error')).toBe(false);
    expect(offlineReason('server', 'connected')).toBeUndefined();
    expect(offlineReason('agentcore', 'signed-out')).toMatch(/sign in/i);
    expect(offlineReason('server', 'disconnected')).toMatch(/not connected/i);
  });
});

describe('error codes → friendly text', () => {
  it('maps known codes and falls back to the message', () => {
    expect(errorText({ message: 'x', code: 'quota' } as { message: string })).toBe('You’ve used today’s AI helpers — back tomorrow!');
    expect(errorText({ message: 'x', code: 'auth' } as { message: string })).toBe('Please sign in again');
    expect(errorText({ message: 'x', code: 'unlinked' } as { message: string })).toBe('Connect your AWS account in the Deploy tab');
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
