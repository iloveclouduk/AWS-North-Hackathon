import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Progress } from '../world.js';

export const ProgressSchema = z
  .object({
    version: z.literal(1),
    landmarks: z.record(z.string().max(64), z.object({ discovered: z.boolean(), xp: z.number().int().min(0).max(1_000_000) }).strict()),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((p) => Object.keys(p.landmarks).length <= 200, 'too many landmarks');

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
