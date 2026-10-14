import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { serviceCredentials } from '../aws.js';
import type { Config } from '../config.js';

type Params = Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>;
export interface LlmOptions {
  light?: boolean;
  fallback?: boolean;
}

/**
 * Claude via Amazon Bedrock (bedrock-runtime InvokeModel), authenticated with the same workshop profile.
 * Server-side `fallbacks` isn't available on Bedrock, so a refusal is retried once on the fallback model
 * (the documented client-side fallback pattern) — by `metered`, so the retry counts against the quota too.
 */
export const createLlm = (config: Config) => {
  const client = new AnthropicBedrock({
    awsRegion: config.region,
    // The SDK default is 10 minutes per attempt; a turn should fail well inside the 100 s deploy drain.
    timeout: 90_000,
    maxRetries: 2,
    providerChainResolver: async () => serviceCredentials(config),
  });

  const modelFor = (opts: LlmOptions) => (opts.fallback ? config.fallbackModel : opts.light ? config.lightModel : config.model);

  return {
    model: config.model,
    /** The Bedrock client itself, for the Strands citizens (same InvokeModel route, same credentials). */
    client: client as unknown as Anthropic,
    /** No limits here; `metered` replaces this with the kill switch and quotas. */
    gate: async (): Promise<void> => undefined,

    /**
     * `light` = the cheaper model (page classification); planning, agents and the Copilot use the main one.
     * `fallback` = the refusal fallback model.
     */
    async create(params: Params, opts: LlmOptions = {}): Promise<Anthropic.Message> {
      return client.messages.create({ ...params, model: modelFor(opts) });
    },

    /** Whether a refusal on this route can be retried on a different model. */
    canFallBack: (opts: LlmOptions = {}) => !opts.fallback && config.fallbackModel !== modelFor(opts),

    /** Streams text deltas (chat answers, on the light model); resolves with the final message. */
    async stream(params: Params, onText: (delta: string) => void): Promise<Anthropic.Message> {
      const stream = client.messages.stream({ ...params, model: config.lightModel });
      stream.on('text', onText);
      return stream.finalMessage();
    },
  };
};

export type Llm = ReturnType<typeof createLlm>;
