import type { Resource, WorldSnapshot } from '../src/state/model.js';

export const ACCOUNT = '123456789012';

export const instance = (id: string, state: string, managedByGame = true, name = id): Resource => ({
  id,
  service: 'ec2',
  kind: 'instance',
  name,
  state,
  managedByGame,
  meta: { instanceType: 't4g.micro' },
});

export const table = (name: string, state = 'ACTIVE'): Resource => ({
  id: name,
  service: 'dynamodb',
  kind: 'table',
  name,
  state,
  managedByGame: name.startsWith('city-'),
  meta: {},
});

export const bucket = (name: string): Resource => ({
  id: name,
  service: 's3',
  kind: 'bucket',
  name,
  state: 'active',
  managedByGame: name.startsWith(`aws-city-${ACCOUNT}-`),
  meta: {},
});

export const snapshot = (resources: Resource[], overrides: Partial<WorldSnapshot> = {}): WorldSnapshot => ({
  takenAt: '2026-09-25T12:00:00.000Z',
  region: 'us-west-2',
  accountId: ACCOUNT,
  credentials: 'ok',
  services: { ec2: 'ok', dynamodb: 'ok', s3: 'ok', lambda: 'ok', rds: 'ok', apigateway: 'ok' },
  resources,
  ...overrides,
});
