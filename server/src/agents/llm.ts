import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { refreshingProfile } from '../aws.js';
import type { Config } from '../config.js';

type Params = Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>;

/**
 * Claude via Amazon Bedrock (bedrock-runtime InvokeModel), authenticated with the same workshop profile.
 * Server-side `fallbacks` isn't available on Bedrock, so a refusal is retried once on the fallback model
 * (the documented client-side fallback pattern).
 */
export const createLlm = (config: Config) => {
  const client = new AnthropicBedrock({
    awsRegion: config.region,
    providerChainResolver: async () => refreshingProfile(config.awsProfile),
  });

  return {
    model: config.model,

    async create(params: Params): Promise<Anthropic.Message> {
      const first = await client.messages.create({ ...params, model: config.model });
      if (first.stop_reason !== 'refusal' || config.fallbackModel === config.model) return first;
      console.warn(`[llm] ${config.model} refused; retrying on ${config.fallbackModel}`);
      return client.messages.create({ ...params, model: config.fallbackModel });
    },

    /** Streams text deltas (for chat answers); resolves with the final message. */
    async stream(params: Params, onText: (delta: string) => void): Promise<Anthropic.Message> {
      const stream = client.messages.stream({ ...params, model: config.model });
      stream.on('text', onText);
      return stream.finalMessage();
    },
  };
};

export type Llm = ReturnType<typeof createLlm>;
