import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/state/diff.js';
import { instance, snapshot, table } from './fixtures.js';

describe('diffSnapshots', () => {
  it('emits nothing for the first snapshot', () => {
    expect(diffSnapshots(null, snapshot([instance('i-00000001', 'running')]))).toEqual([]);
  });

  it('detects created, deleted and state changes', () => {
    const prev = snapshot([instance('i-00000001', 'pending'), table('city-old')]);
    const next = snapshot([instance('i-00000001', 'running'), table('city-new', 'CREATING')]);
    const events = diffSnapshots(prev, next);

    expect(events).toContainEqual({ type: 'stateChanged', resource: next.resources[0], from: 'pending', to: 'running' });
    expect(events).toContainEqual({ type: 'created', resource: next.resources[1] });
    expect(events).toContainEqual({ type: 'deleted', resource: prev.resources[1] });
    expect(events).toHaveLength(3);
  });

  it('does not report deletions for a service that failed to read', () => {
    const prev = snapshot([table('city-a')]);
    const next = snapshot([], { services: { ...prev.services, dynamodb: 'error' } });
    expect(diffSnapshots(prev, next)).toEqual([]);
  });

  it('reports a newly locked service without demolishing its buildings', () => {
    const prev = snapshot([table('city-a')]);
    const next = snapshot([], { services: { ...prev.services, dynamodb: 'locked' } });
    expect(diffSnapshots(prev, next)).toEqual([{ type: 'serviceLocked', service: 'dynamodb' }]);
  });

  it('reports credential expiry and recovery', () => {
    const ok = snapshot([]);
    const expired = snapshot([], { credentials: 'expired' });
    expect(diffSnapshots(ok, expired)).toEqual([{ type: 'credentialsExpired' }]);
    expect(diffSnapshots(expired, ok)).toEqual([{ type: 'credentialsRestored' }]);
  });
});
