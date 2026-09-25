import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';
import { log } from '../log.js';
import { type QuotaStore, today } from '../store/types.js';
import type { Llm } from './llm.js';

/** Thrown instead of calling Bedrock. The message is shown to the player as-is. */
export class ModelLimitError extends Error {
  constructor(readonly code: 'quota' | 'paused', message: string) {
    super(message);
  }
}
export const QUOTA_MESSAGE = 'You’ve used today’s AI helpers — they’ll be back tomorrow!';
export const PAUSED_MESSAGE = 'The city’s AI is resting right now. Learning, cards and games still work.';

/**
 * Kill switch: an SSM parameter set to "false" turns every model call off within ~30 s.
 * Unreadable parameter = keep running (the Budgets action is the hard stop: it denies Bedrock to the task role).
 */
export const killSwitch = (deps: { ssm?: SSMClient; name?: string; cacheMs?: number; now?: () => number }) => {
  let cached: { on: boolean; at: number } | undefined;
  const now = deps.now ?? Date.now;
  return async (): Promise<boolean> => {
    if (!deps.ssm || !deps.name) return true;
    if (cached && now() - cached.at < (deps.cacheMs ?? 30_000)) return cached.on;
    try {
      const out = await deps.ssm.send(new GetParameterCommand({ Name: deps.name }));
      cached = { on: out.Parameter?.Value?.trim().toLowerCase() !== 'false', at: now() };
    } catch (err) {
      log.warn('kill switch unreadable', { err: (err as Error).name });
      cached = { on: cached?.on ?? true, at: now() };
    }
    return cached.on;
  };
};

/**
 * Every Bedrock call for a player goes through here: kill switch → the player's daily quota → the
 * global daily cap. Counters are atomic (DynamoDB conditional ADD when hosted), so parallel sockets
 * or tasks can't overshoot.
 */
export const metered = (llm: Llm, deps: { sub: string; quota: QuotaStore; daily: number; globalDaily: number; enabled: () => Promise<boolean>; now?: () => number }): Llm => {
  const gate = async () => {
    if (!(await deps.enabled())) throw new ModelLimitError('paused', PAUSED_MESSAGE);
    const day = today(deps.now?.());
    if (!(await deps.quota.consume(deps.sub, day, deps.daily))) {
      log.metric('QuotaRejected', 1);
      throw new ModelLimitError('quota', QUOTA_MESSAGE);
    }
    if (!(await deps.quota.consume('GLOBAL', day, deps.globalDaily))) {
      log.metric('GlobalQuotaRejected', 1);
      throw new ModelLimitError('paused', PAUSED_MESSAGE);
    }
    log.metric('ModelCalls', 1);
  };
  return {
    model: llm.model,
    async create(params, opts) {
      await gate();
      return llm.create(params, opts);
    },
    async stream(params, onText) {
      await gate();
      return llm.stream(params, onText);
    },
  };
};

/** Error events caused by a limit get a machine-readable code so the UI can explain them kindly. */
export const withErrorCodes = <E extends { type: string; message?: string; code?: string }>(emit: (e: E) => void) => (e: E) => {
  if (e.type === 'error' && e.message && !e.code) {
    if (e.message.includes(QUOTA_MESSAGE)) return emit({ ...e, code: 'quota' });
    if (e.message.includes(PAUSED_MESSAGE)) return emit({ ...e, code: 'paused' });
  }
  emit(e);
};
