import { describe, expect, it } from 'vitest';
import { type Action, parseAction, toolDefinitions } from '../src/agents/actions.js';
import { checkAction, LIMITS } from '../src/agents/policy.js';
import { ACCOUNT, bucket, instance, snapshot, table } from './fixtures.js';

const parse = (name: string, input: unknown): Action => {
  const r = parseAction(name, input);
  if (!r.ok) throw new Error(r.error);
  return r.action;
};

describe('parseAction (untrusted tool calls / player input)', () => {
  it('accepts a valid launch and fills the default instance type', () => {
    expect(parse('launch_instance', { name: 'my house' })).toEqual({ type: 'launch_instance', name: 'my house', instanceType: 't4g.micro' });
  });

  it.each([
    ['unknown tool', 'rm_rf', {}],
    ['large instance type', 'launch_instance', { name: 'big', instanceType: 'm5.large' }],
    ['extra region field', 'launch_instance', { name: 'x', region: 'us-east-1' }],
    ['bad instance id', 'stop_instance', { instanceId: 'not-an-id' }],
    ['table without prefix', 'create_table', { name: 'users' }],
    ['uppercase bucket suffix', 'create_bucket', { suffix: 'Crates' }],
    ['wrong input type', 'stop_instance', 'i-0123456789abcdef0'],
  ])('rejects %s', (_label, name, input) => {
    expect(parseAction(name, input).ok).toBe(false);
  });

  it('generates a tool definition for every action', () => {
    const tools = toolDefinitions();
    expect(tools.map((t) => t.name)).toContain('launch_instance');
    for (const t of tools) {
      expect(t.input_schema.type).toBe('object');
      expect(t.description.length).toBeGreaterThan(10);
    }
    const launch = tools.find((t) => t.name === 'launch_instance')!;
    expect(JSON.stringify(launch.input_schema)).toContain('t4g.nano');
  });
});

describe('checkAction (guardrails)', () => {
  const mine = instance('i-0000000000000001a', 'running', true, 'my house');
  const theirs = instance('i-0000000000000002b', 'running', false, 'workshop server');

  it('allows stopping a game-built instance', () => {
    expect(checkAction(parse('stop_instance', { instanceId: mine.id }), snapshot([mine]), { confirmed: false }).verdict).toBe('allow');
  });

  it('refuses to touch resources the game did not build', () => {
    const d = checkAction(parse('stop_instance', { instanceId: theirs.id }), snapshot([theirs]), { confirmed: true });
    expect(d).toMatchObject({ verdict: 'deny' });
  });

  it('refuses unknown targets', () => {
    expect(checkAction(parse('start_instance', { instanceId: 'i-0000000000000009f' }), snapshot([]), { confirmed: false }).verdict).toBe('deny');
  });

  it('enforces the instance limit (terminated ones do not count)', () => {
    const live = Array.from({ length: LIMITS.instances }, (_, n) => instance(`i-000000000000000${n}c`, 'running'));
    const launch = parse('launch_instance', { name: 'one more' });
    expect(checkAction(launch, snapshot(live), { confirmed: false }).verdict).toBe('deny');
    const withDead = [...live.slice(1), instance('i-00000000000000dead', 'terminated')];
    expect(checkAction(launch, snapshot(withDead), { confirmed: false }).verdict).toBe('allow');
  });

  it('requires player approval for destructive actions', () => {
    const terminate = parse('terminate_instance', { instanceId: mine.id });
    expect(checkAction(terminate, snapshot([mine]), { confirmed: false }).verdict).toBe('confirm');
    expect(checkAction(terminate, snapshot([mine]), { confirmed: true }).verdict).toBe('allow');
    const drop = parse('delete_table', { name: 'city-books' });
    expect(checkAction(drop, snapshot([table('city-books')]), { confirmed: false }).verdict).toBe('confirm');
  });

  it("only deletes this account's game buckets", () => {
    const other = parse('delete_bucket', { name: 'aws-city-999999999999-crates' });
    expect(checkAction(other, snapshot([bucket('aws-city-999999999999-crates')]), { confirmed: true }).verdict).toBe('deny');
    const own = `aws-city-${ACCOUNT}-crates`;
    expect(checkAction(parse('delete_bucket', { name: own }), snapshot([bucket(own)]), { confirmed: true }).verdict).toBe('allow');
  });

  it('blocks every write while credentials are expired', () => {
    const d = checkAction(parse('launch_instance', { name: 'x' }), snapshot([], { credentials: 'expired' }), { confirmed: false });
    expect(d.verdict).toBe('deny');
  });
});
