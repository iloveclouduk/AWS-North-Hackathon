// "Explain it back": a rules-only first look at the player's words, and a framed question for the building's agent.
import { describe, expect, it } from 'vitest';
import { checkExplain, EXPLAIN_MARK, explainQuestion, explainService, framedExplain, MAX_CHARS } from '@/state/explain';
import { QUESTS } from '@/world/content';

describe('explain it back', () => {
  it('every quest asks about a real service', () => {
    for (const q of QUESTS) expect(explainQuestion(q), q.id).not.toContain(' it do');
  });

  it('finds the key ideas used, never counting the name', () => {
    const c = checkExplain('s3', 'S3 keeps every file as an object in a bucket, so I can store a backup.');
    expect(c.tooShort).toBe(false);
    expect(c.mentioned).toEqual(expect.arrayContaining(['bucket', 'object', 'file', 'backup', 'store']));
    expect(c.mentioned).not.toContain('s3');
    expect(checkExplain('s3', 'It stores stuff').tooShort).toBe(true);
    expect(checkExplain('s3', 'nothing relevant at all here really, sorry about that').missed.length).toBe(3);
  });

  it('frames the answer for the agent, capped and marked', () => {
    const q = QUESTS[0];
    const f = framedExplain(q, 'x'.repeat(5000));
    expect(f.startsWith(EXPLAIN_MARK)).toBe(true);
    expect(f.length).toBeLessThan(2000);
    expect(f).toContain('x'.repeat(MAX_CHARS));
    expect(f).not.toContain('x'.repeat(MAX_CHARS + 1));
    expect(explainService(q)).toBe(q.serviceIds[0]);
  });
});
