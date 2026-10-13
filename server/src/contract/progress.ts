import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Progress } from '../world.js';

const key = z.string().min(1).max(100);
/** A record with at most `max` keys (a learner's progress, never a fleet). */
const bounded = <T extends z.ZodType>(value: T, max: number, what: string) =>
  z.record(key, value).refine((r) => Object.keys(r).length <= max, `too many ${what}`);

const landmark = z.object({ discovered: z.boolean(), xp: z.number().int().min(0).max(1_000_000) }).strict();

/** Mirrors Progress in src/backend/contract.ts (v1 and v2, with the v2.3 citizens and fixes, the v2.4 streak, the v2.5 bill switch and the v2.7 cities). Strict: unknown fields fail. */
export const ProgressSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    landmarks: bounded(landmark, 200, 'landmarks'),
    /** v2.7: each Region's own city (src/state/cities.ts). */
    cities: z
      .record(z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/), z.object({ landmarks: bounded(landmark, 200, 'landmarks') }).strict())
      .refine((r) => Object.keys(r).length <= 60, 'too many cities')
      .optional(),
    cards: bounded(
      z.object({ interval: z.number().min(0).max(36_500), ease: z.number().min(1).max(5), due: z.number().int().min(0), reps: z.number().int().min(0).max(100_000) }).strict(),
      2_000,
      'cards',
    ).optional(),
    quests: bounded(z.object({ status: z.enum(['active', 'done']), step: z.number().int().min(0).max(100), count: z.number().int().min(0).max(10_000).optional() }).strict(), 200, 'quests').optional(),
    puzzles: bounded(z.object({ best: z.number().min(0).max(100) }).strict(), 200, 'puzzles').optional(),
    games: bounded(z.object({ best: z.number().min(0).max(1_000_000), plays: z.number().int().min(0).max(1_000_000) }).strict(), 50, 'games').optional(),
    citizens: bounded(z.object({ xp: z.number().int().min(0).max(1_000_000) }).strict(), 20, 'citizens').optional(),
    fixes: bounded(z.iso.datetime({ offset: true }), 1_000, 'fixes').optional(),
    streak: z
      .object({
        days: z.number().int().min(1).max(100_000),
        last: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
        best: z.number().int().min(1).max(100_000),
      })
      .strict()
      .optional(),
    /** v2.5: the bill switch. */
    bill: z.boolean().optional(),
    flow: z.boolean().optional(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

/** GET/PUT /progress, stored as a local JSON file (the player's own progress on their own machine). */
export const createProgressStore = (file: string) => {
  let cache: Progress | null | undefined;
  // The side panel and the full-tab city both PUT; serialise writes so they never race on the file.
  let writes: Promise<unknown> = Promise.resolve();

  const load = async (): Promise<Progress | null> => {
    if (cache !== undefined) return cache;
    try {
      const parsed = ProgressSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
      cache = parsed.success ? (parsed.data as Progress) : null;
    } catch {
      cache = null;
    }
    return cache;
  };

  return {
    get: load,
    /** Keeps the newest copy (by updatedAt), matching the contract's "newest wins" rule. */
    put(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
      const parsed = ProgressSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve({ ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      const run = writes.then(async () => {
        const current = await load();
        if (current && Date.parse(current.updatedAt) > Date.parse(parsed.data.updatedAt)) return { ok: true as const };
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(parsed.data, null, 2));
        await rename(tmp, file);
        cache = parsed.data as Progress;
        return { ok: true as const };
      });
      writes = run.catch(() => undefined);
      return run;
    },
  };
};

export type ProgressStore = ReturnType<typeof createProgressStore>;
