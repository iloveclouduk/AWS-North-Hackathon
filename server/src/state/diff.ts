import { type AwsEvent, resourceKey, SERVICES, type WorldSnapshot } from './model.js';

/** Turns two consecutive snapshots into the AWS changes the game should react to. */
export const diffSnapshots = (prev: WorldSnapshot | null, next: WorldSnapshot): AwsEvent[] => {
  // The first snapshot is delivered whole via /snapshot and the SSE hello, not as a burst of events.
  if (!prev) return [];

  const events: AwsEvent[] = [];

  if (prev.credentials !== next.credentials) {
    events.push({ type: next.credentials === 'expired' ? 'credentialsExpired' : 'credentialsRestored' });
  }

  for (const service of SERVICES) {
    const before = prev.services[service];
    const after = next.services[service];
    if (before !== 'locked' && after === 'locked') events.push({ type: 'serviceLocked', service });
    if (before === 'locked' && after === 'ok') events.push({ type: 'serviceUnlocked', service });
  }

  const prevByKey = new Map(prev.resources.map((r) => [resourceKey(r), r]));
  const nextByKey = new Map(next.resources.map((r) => [resourceKey(r), r]));

  for (const [key, r] of nextByKey) {
    const old = prevByKey.get(key);
    if (!old) events.push({ type: 'created', resource: r });
    else if (old.state !== r.state) events.push({ type: 'stateChanged', resource: r, from: old.state, to: r.state });
  }

  for (const [key, r] of prevByKey) {
    // Only trust a disappearance when the service was actually read this round.
    if (!nextByKey.has(key) && next.services[r.service] === 'ok') events.push({ type: 'deleted', resource: r });
  }

  return events;
};
