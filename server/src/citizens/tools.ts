import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { docsBlock, type Knowledge } from '../knowledge/mcp.js';
import { ACTION_SCHEMAS, type ActionName } from '../agents/actions.js';
import { outcomeMessage, outcomeText, type ToolCallReport, type TurnHooks } from '../agents/runner.js';
import type { ActionService, SubmitOutcome } from '../agents/service.js';

/** What a tool callback needs from the turn that's running (set by the engine before each invoke). */
export interface TurnContext {
  hooks: TurnHooks;
  toolCalls: ToolCallReport[];
}

/**
 * Our allowlisted actions as Strands tools. The callback goes through ActionService.submit, so input is validated
 * again, policy is checked, and every write waits for the player's approval: Strands never talks to AWS itself.
 * There is deliberately no generic AWS-calling tool from the Strands tools package, no shell and no sandbox.
 */
export const actionTools = (names: ActionName[], deps: { actions: ActionService; turn: () => TurnContext | undefined }) =>
  names.map((name) =>
    tool({
      name,
      description: ACTION_SCHEMAS[name].description ?? name,
      inputSchema: ACTION_SCHEMAS[name] as unknown as z.ZodObject,
      callback: async (input: unknown) => {
        const ctx = deps.turn();
        const outcome: SubmitOutcome = ctx?.hooks.approve ? await deps.actions.submit(name, input, { approve: ctx.hooks.approve }) : await deps.actions.submit(name, input);
        const report: ToolCallReport = { name, input, outcome: outcome.status, message: outcomeMessage(outcome) };
        ctx?.toolCalls.push(report);
        ctx?.hooks.onToolEnd?.(report);
        return outcomeText(outcome);
      },
    }),
  );

export const SEARCH_DOCS = 'search_aws_docs';

/** Read-only AWS documentation search through the allow-listed Knowledge MCP client (results wrapped as data). */
export const docsTool = (knowledge: Knowledge, sources: () => { title: string; url: string }[] | undefined) =>
  tool({
    name: SEARCH_DOCS,
    description: 'Search the official AWS documentation (read-only). Use it to check a fact before you explain it.',
    inputSchema: z.object({ query: z.string().min(2).max(200) }).strict(),
    callback: async ({ query }) => {
      const hits = await knowledge.search(query, 3);
      sources()?.push(...hits.map(({ title, url }) => ({ title, url })));
      return hits.length ? docsBlock(hits) : 'No matching AWS documentation found.';
    },
  });
