import type Anthropic from '@anthropic-ai/sdk';
import type { Message, StreamOptions } from '@strands-agents/sdk';
import { AnthropicModel } from '@strands-agents/sdk/models/anthropic';
import { log } from '../log.js';

/**
 * Strands' Anthropic model on our Bedrock client (InvokeModel, the workshop's route to the 5.x models), with every
 * model call going through the same gate as the rest of the server: kill switch, the player's quota, the global cap.
 * Never give the agent a structuredOutputSchema: that is the one place Strands forces tool_choice, which Bedrock
 * rejects while thinking is on (agent.ts structuredOutputChoice, @strands-agents/sdk 1.20.0).
 */
export class MeteredAnthropicModel extends AnthropicModel {
  constructor(
    opts: { client: Anthropic; modelId: string; maxTokens: number; effort?: 'low' | 'medium' | 'high' },
    private readonly gate: () => Promise<void>,
  ) {
    super({
      client: opts.client,
      modelId: opts.modelId,
      maxTokens: opts.maxTokens,
      ...(opts.effort ? { params: { output_config: { effort: opts.effort } } } : {}),
      cacheConfig: { strategy: 'auto' },
    });
  }

  override async *stream(messages: Message[], options?: StreamOptions) {
    await this.gate();
    for await (const event of super.stream(messages, options)) {
      if (event.type === 'modelMetadataEvent' && event.usage) {
        log.metric('InputTokens', event.usage.inputTokens ?? 0);
        log.metric('OutputTokens', event.usage.outputTokens ?? 0);
        log.metric('CacheReadTokens', event.usage.cacheReadInputTokens ?? 0);
      }
      yield event;
    }
  }
}
