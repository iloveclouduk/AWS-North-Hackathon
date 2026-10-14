import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';
import { log } from '../log.js';
import { type QuotaStore, today } from '../store/types.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { Llm } from './llm.js';

/** Thrown instead of calling Bedrock. The message is shown to the player as-is. */
export class ModelLimitError extends Error {
  constructor(readonly code: 'quota' | 'paused', message: string) {
    super(message);
  }
  get publicMessage() {
    return this.message;
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
 * Every Bedrock call for a player goes through here: kill switch → the player's daily quota (read) → the
 * global daily cap → the player's quota (counted). Counters are atomic (DynamoDB conditional ADD when hosted), so parallel sockets
 * or tasks can't overshoot.
 */
export const metered = (llm: Llm, deps: { sub: string; quota: QuotaStore; daily: number; globalDaily: number; enabled: () => Promise<boolean>; now?: () => number }): Llm => {
  const gate = async () => {
    if (!(await deps.enabled())) throw new ModelLimitError('paused', PAUSED_MESSAGE);
    const day = today(deps.now?.());
    const overQuota = () => {
      log.metric('QuotaRejected', 1);
      return new ModelLimitError('quota', QUOTA_MESSAGE);
    };
    // A player already at their quota is refused before the global count (one player can't use up the city's cap),
    // and a global refusal comes before the player's count (it doesn't burn their quota).
    if ((await deps.quota.used(deps.sub, day)) >= deps.daily) throw overQuota();
    if (!(await deps.quota.consume('GLOBAL', day, deps.globalDaily))) {
      log.metric('GlobalQuotaRejected', 1);
      throw new ModelLimitError('paused', PAUSED_MESSAGE);
    }
    // Still atomic: parallel calls that all passed the read are cut off here.
    if (!(await deps.quota.consume(deps.sub, day, deps.daily))) throw overQuota();
    log.metric('ModelCalls', 1);
  };
  /** Bedrock still throttling after the SDK's own retries: counted for the ModelThrottled alarm. */
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      const e = err as { status?: number; name?: string };
      if (e?.status === 429 || e?.name === 'ThrottlingException') log.metric('ModelThrottled', 1);
      throw err;
    }
  };
  /** Token use per call (EMF): what the bill is made of, and whether prompt caching is working. */
  const record = (msg: Anthropic.Message) => {
    const u = msg.usage;
    if (!u) return msg;
    log.metric('InputTokens', u.input_tokens ?? 0);
    log.metric('OutputTokens', u.output_tokens ?? 0);
    log.metric('CacheReadTokens', u.cache_read_input_tokens ?? 0);
    return msg;
  };
  return {
    model: llm.model,
    client: llm.client,
    /** The same checks for model calls made outside create/stream (the Strands citizens' model). */
    gate,
    canFallBack: llm.canFallBack,
    async create(params, opts = {}) {
      await gate();
      const first = record(await call(() => llm.create(params, opts)));
      if (first.stop_reason !== 'refusal' || !llm.canFallBack(opts)) return first;
      // The client-side refusal fallback is a second Bedrock call: it goes through the same gate.
      log.warn('model refused; retrying on fallback', { light: Boolean(opts.light) });
      log.metric('Refusals', 1);
      await gate();
      return record(await call(() => llm.create(params, { ...opts, fallback: true })));
    },
    async stream(params, onText) {
      await gate();
      return record(await call(() => llm.stream(params, onText)));
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
