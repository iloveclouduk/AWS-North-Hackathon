import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelLimitError, QUOTA_MESSAGE } from '../src/agents/metered.js';

describe('errors players see', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('hosted: no AWS details reach the player, only a reference', async () => {
    vi.stubEnv('AWS_CITY_MODE', 'hosted');
    vi.resetModules();
    const { publicError } = await import('../src/log.js');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const leak = Object.assign(new Error('User: arn:aws:sts::999999999999:assumed-role/AWSCityTaskRole-prod is not authorized'), { name: 'AccessDeniedException' });
    const shown = publicError('chat failed', leak);
    expect(shown).not.toContain('999999999999');
    const ref = /ref ([0-9a-f]{6})/.exec(shown)?.[1];
    expect(ref).toBeDefined();
    expect(String(write.mock.calls[0]?.[0])).toContain(ref!);
    expect(publicError('chat failed', Object.assign(new Error('Too many requests'), { status: 429 }))).toMatch(/busy/);
    write.mockRestore();
  });

  it('public mode follows the config (set at startup), not only AWS_CITY_MODE', async () => {
    const { publicError, setPublicErrors } = await import('../src/log.js');
    expect(publicError('chat failed', new Error('arn:aws:iam::999999999999:role/x'))).toContain('999999999999');
    setPublicErrors(true);
    const errLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(publicError('chat failed', new Error('arn:aws:iam::999999999999:role/x'))).toMatch(/^Something went wrong on our side \(ref [0-9a-f]{6}\)/);
    errLog.mockRestore();
  });

  it('failed AWS actions: public players get the error name and a plain sentence, the log gets the rest', async () => {
    const { setPublicErrors } = await import('../src/log.js');
    const { awsFailure } = await import('../src/agents/executor.js');
    const denied = Object.assign(new Error('User: arn:aws:sts::111122223333:assumed-role/AWSCityPlayerRole-us-west-2/x is not authorized'), { name: 'AccessDenied' });
    const other = Object.assign(new Error('Something in account 111122223333\r\nbroke'), { name: 'WeirdError' });
    expect(awsFailure(denied)).toContain('111122223333'); // local: the developer's own account, full detail
    setPublicErrors(true);
    expect(awsFailure(denied)).toBe("AWS denied this (AccessDenied): the player role doesn't allow that.");
    expect(awsFailure(Object.assign(new Error('x'), { name: 'BucketAlreadyExists' }))).toBe('AWS error (BucketAlreadyExists): that bucket name is taken.');
    const shown = awsFailure(other);
    expect(shown).toMatch(/^AWS error \(WeirdError\): that didn't work \(ref [0-9a-f]{6}\)\.$/);
    expect(shown).not.toContain('111122223333');
  });

  it('limit errors written for players pass through unchanged', async () => {
    const { publicError } = await import('../src/log.js');
    expect(publicError('chat failed', new ModelLimitError('quota', QUOTA_MESSAGE))).toBe(QUOTA_MESSAGE);
  });
});
