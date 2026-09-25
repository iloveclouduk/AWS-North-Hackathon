// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { findExact, findTarget, typeInto } from '@/console/act';
import { redact } from '@/console/risk';
import { isConsoleUrl, isRisky, mayAct } from '@/console/safety';
import { takeSnapshot } from '@/console/snapshot';

const S3_PAGE = `
  <h1>Create bucket</h1>
  <form>
    <fieldset><legend>General configuration</legend>
      <label for="name">Bucket name</label><input id="name" type="text" />
      <label for="region">AWS Region</label>
      <select id="region"><option value="us-west-2">US West (Oregon)</option><option value="eu-west-2">Europe (London)</option></select>
    </fieldset>
    <fieldset><legend>Block Public Access settings for this bucket</legend>
      <label><input type="checkbox" id="bpa" checked /> Block all public access</label>
    </fieldset>
    <label for="pw">Password</label><input id="pw" type="password" value="hunter2" />
    <input type="text" name="secretAccessKey" aria-label="Secret key" value="AKIA-SECRET" />
    <button type="submit">Create bucket</button>
    <button type="button">Delete bucket</button>
    <button type="button" hidden>Hidden thing</button>
  </form>`;

beforeEach(() => {
  document.body.innerHTML = S3_PAGE;
});

describe('console snapshot', () => {
  it('lists visible controls by accessible name, with section context', () => {
    const snap = takeSnapshot(document, { requireLayout: false });
    const names = snap.items.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['Bucket name', 'AWS Region', 'Block all public access', 'Create bucket', 'Delete bucket']));
    expect(names).not.toContain('Hidden thing');
    expect(snap.heading).toBe('Create bucket');
    expect(snap.items.find((i) => i.name === 'Bucket name')?.context).toBe('General configuration');
    expect(snap.items.find((i) => i.name === 'Block all public access')).toMatchObject({ role: 'checkbox', checked: true });
  });

  it('never reads secret values', () => {
    const snap = takeSnapshot(document, { requireLayout: false });
    const json = JSON.stringify(snap);
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('AKIA-SECRET');
    expect(snap.items.find((i) => i.name === 'Password')).toMatchObject({ sensitive: true });
    expect(snap.items.find((i) => i.name === 'Secret key')).toMatchObject({ sensitive: true });
  });
});

describe('safety', () => {
  it('flags destructive, public, IAM-admin, credential and billing controls as risky', () => {
    for (const n of ['Delete bucket', 'Terminate instance', 'Empty', 'Attach policies', 'AdministratorAccess', 'Create access key', 'Billing preferences', 'Sign out'])
      expect(isRisky(n), n).toBe(true);
    for (const n of ['Create bucket', 'Next', 'Bucket name', 'Create table']) expect(isRisky(n), n).toBe(false);
  });

  it('mayAct refuses risky clicks and secret fields, allows safe ones', () => {
    const items = takeSnapshot(document, { requireLayout: false }).items;
    const by = (n: string) => items.find((i) => i.name === n);
    expect(mayAct(by('Delete bucket'), 'click')).toMatchObject({ ok: false, reason: 'risky' });
    expect(mayAct(by('Password'), 'type')).toMatchObject({ ok: false, reason: 'sensitive' });
    expect(mayAct(by('Create bucket'), 'click')).toEqual({ ok: true });
    expect(mayAct(undefined, 'click')).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('only runs on real console pages, never sign-in or other sites', () => {
    expect(isConsoleUrl('https://eu-west-2.console.aws.amazon.com/s3/bucket/create')).toBe(true);
    expect(isConsoleUrl('https://signin.aws.amazon.com/oauth')).toBe(false);
    expect(isConsoleUrl('https://console.aws.amazon.com.evil.com/')).toBe(false);
    expect(isConsoleUrl('http://console.aws.amazon.com/')).toBe(false);
  });
});

describe('acting on the page', () => {
  it('finds targets by id or by name, and types so React forms notice', () => {
    const snap = takeSnapshot(document, { requireLayout: false });
    const nameItem = snap.items.find((i) => i.name === 'Bucket name')!;
    const el = findTarget(document, { id: nameItem.id, name: 'x' })!;
    const events: string[] = [];
    el.addEventListener('input', () => events.push('input'));
    el.addEventListener('change', () => events.push('change'));
    typeInto(el, 'aws-city-demo-123');
    expect((el as HTMLInputElement).value).toBe('aws-city-demo-123');
    expect(events).toEqual(['input', 'change']);
    expect(findTarget(document, { name: 'create bucket' })?.textContent).toBe('Create bucket');
  });

  it('refuses to type into secret fields', () => {
    takeSnapshot(document, { requireLayout: false });
    expect(() => typeInto(document.getElementById('pw')!, 'x')).toThrow(/secret/);
  });
});

describe('security hardening', () => {
  it('never sends typed values, and redacts account IDs, keys, emails and tokens from page text', () => {
    document.body.innerHTML = `<h1>Account 1234-5678-9012 · admin@example.com</h1>
      <label for="d">Description</label><input id="d" type="text" value="my private notes" />
      <button type="button">Use key AKIAIOSFODNN7EXAMPLE</button>`;
    const json = JSON.stringify(takeSnapshot(document, { requireLayout: false }));
    expect(json).not.toContain('my private notes');
    expect(json).toContain('(filled)');
    expect(json).not.toContain('1234-5678-9012');
    expect(json).not.toContain('admin@example.com');
    expect(json).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redact('token abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toBe('token [token]');
  });

  it('refuses a destructive control disguised with an innocent label, and links that leave the console', () => {
    document.body.innerHTML = `<button type="button" aria-label="Next" data-testid="delete-bucket-button">Next</button>
      <button type="button" aria-label="Continue" class="awsui-button-variant-danger">Continue</button>
      <a href="https://evil.example.com/steal">Learn more</a>
      <a href="/s3/buckets">Buckets</a>`;
    const items = takeSnapshot(document, { requireLayout: false }).items;
    const el = (name: string) => findExact(document, { id: items.find((i) => i.name === name)!.id, name })!;
    const item = (name: string) => items.find((i) => i.name === name);
    expect(mayAct(item('Next'), 'click', el('Next'))).toMatchObject({ ok: false, reason: 'risky' });
    expect(mayAct(item('Continue'), 'click', el('Continue'))).toMatchObject({ ok: false, reason: 'risky' });
    expect(mayAct(item('Learn more'), 'click', el('Learn more'))).toMatchObject({ ok: false, reason: 'risky' });
  });

  it('acting uses only the exact snapshot element — no fuzzy redirect to a look-alike', () => {
    document.body.innerHTML = `<button type="button">Create bucket</button>`;
    takeSnapshot(document, { requireLayout: false });
    expect(findExact(document, { name: 'Create bucket' })).toBeUndefined(); // no id → no action
    expect(findExact(document, { id: 'nope', name: 'Create bucket' })).toBeUndefined();
    expect(findTarget(document, { name: 'Create bucket' })).toBeDefined(); // pointing may still find it
  });
});

describe('typing is risk-checked too', () => {
  it('refuses to type into a delete-confirmation field or type a destructive value', () => {
    document.body.innerHTML = `<div role="dialog"><h2>Delete bucket</h2>
      <label for="c">To confirm deletion, enter the bucket name</label><input id="c" type="text" /></div>
      <label for="n">Bucket name</label><input id="n" type="text" />`;
    const items = takeSnapshot(document, { requireLayout: false }).items;
    const it = (n: string) => items.find((i) => i.name.startsWith(n))!;
    const el = (n: string) => findExact(document, { id: it(n).id, name: n })!;
    expect(mayAct(it('To confirm'), 'type', el('To confirm'), 'my-bucket')).toMatchObject({ ok: false, reason: 'risky' });
    expect(mayAct(it('Bucket name'), 'type', el('Bucket name'), 'permanently delete')).toMatchObject({ ok: false, reason: 'risky' });
    expect(mayAct(it('Bucket name'), 'type', el('Bucket name'), 'aws-city-demo-1')).toEqual({ ok: true });
  });
});
