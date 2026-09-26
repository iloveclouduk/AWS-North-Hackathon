import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { log } from '../log.js';

/**
 * AWS documentation for the agents, from the AWS Knowledge MCP server (read-only, no credentials,
 * https://knowledge-mcp.global.api.aws). Only the documentation tools below are ever called: never the
 * managed AWS MCP Server, whose `aws___run_script` can call any AWS API.
 */
export const KNOWLEDGE_URL = 'https://knowledge-mcp.global.api.aws';
export const ALLOWED_TOOLS = new Set(['aws___search_documentation', 'aws___read_documentation', 'aws___retrieve_skill']);

export interface DocHit {
  title: string;
  url: string;
  /** A short, trimmed excerpt: untrusted text, always wrapped in <aws_docs> for the model. */
  text: string;
}

export interface Knowledge {
  search(phrase: string, limit?: number): Promise<DocHit[]>;
}

/**
 * Only AWS's own official pages are passed on (shown to players as sources). Not re:Post or other
 * community content: anyone can write that, so it's a prompt-injection channel.
 */
const AWS_HOSTS = new Set(['docs.aws.amazon.com', 'aws.amazon.com']);
const safeUrl = (raw: unknown): string | undefined => {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' && AWS_HOSTS.has(u.hostname) && !u.username && !u.password ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Doc text is untrusted: remove anything tag-like so it can't close our <aws_docs> wrapper or open a
 * fake <city_snapshot>/system block, and collapse whitespace.
 */
export const neutralise = (s: string) => s.replace(/[<>]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** Parses aws___search_documentation's text payload: {"content":{"result":[{title,url,context}]}}. */
export const parseSearch = (result: unknown, maxChars = 700): DocHit[] => {
  const content = (result as { content?: { type: string; text?: string }[] })?.content ?? [];
  const hits: DocHit[] = [];
  for (const block of content) {
    if (block.type !== 'text' || !block.text) continue;
    let json: unknown;
    try {
      json = JSON.parse(block.text);
    } catch {
      continue;
    }
    const rows = (json as { content?: { result?: unknown[] } })?.content?.result ?? [];
    for (const row of rows as { title?: unknown; url?: unknown; context?: unknown }[]) {
      const url = safeUrl(row.url);
      if (!url || typeof row.title !== 'string') continue;
      const text = neutralise(String(row.context ?? '')).slice(0, maxChars);
      hits.push({ title: neutralise(row.title).slice(0, 160), url, text });
    }
  }
  return hits;
};

type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Remote client with a small cache, a timeout and a circuit breaker. It fails open: if the docs
 * service is slow or down, agents answer from what they know (and say less, not wrong).
 */
export const createKnowledge = (opts: { url?: string; timeoutMs?: number; call?: CallTool; now?: () => number; cacheSize?: number } = {}): Knowledge => {
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const cache = new Map<string, { at: number; hits: DocHit[] }>();
  const cacheSize = opts.cacheSize ?? 200;
  let failures = 0;
  let openUntil = 0;
  let client: Promise<Client> | undefined;

  const connect = () =>
    (client ??= (async () => {
      const c = new Client({ name: 'aws-city', version: '1.0.0' });
      await c.connect(new StreamableHTTPClientTransport(new URL(opts.url ?? KNOWLEDGE_URL)));
      return c;
    })().catch((err) => {
      client = undefined;
      throw err;
    }));

  const call: CallTool =
    opts.call ??
    (async (name, args) => {
      const c = await connect();
      return c.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    });

  const guarded: CallTool = (name, args) => {
    if (!ALLOWED_TOOLS.has(name)) throw new Error(`knowledge tool ${name} is not allowed`);
    return call(name, args);
  };

  return {
    async search(phrase, limit = 3) {
      const key = `${limit}|${phrase.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < 6 * 60 * 60_000) return hit.hits;
      if (now() < openUntil) return [];
      try {
        const result = await Promise.race([
          guarded('aws___search_documentation', { search_phrase: phrase.slice(0, 200), limit }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs).unref?.()),
        ]);
        const hits = parseSearch(result).slice(0, limit);
        failures = 0;
        cache.set(key, { at: now(), hits });
        if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
        return hits;
      } catch (err) {
        // After 3 failures in a row, stop asking for a minute.
        if (++failures >= 3) {
          openUntil = now() + 60_000;
          failures = 0;
          client = undefined;
        }
        log.warn('knowledge search failed', { err: (err as Error).message.slice(0, 80) });
        return [];
      }
    },
  };
};

/** No docs (tests, or KNOWLEDGE=off). */
export const noKnowledge: Knowledge = { search: async () => [] };

/** How docs are shown to the model: data, never instructions. */
export const docsBlock = (hits: DocHit[]) =>
  hits.length
    ? `<aws_docs>\n${hits.map((h, i) => `[${i + 1}] ${neutralise(h.title)} — ${h.url}\n${neutralise(h.text)}`).join('\n\n')}\n</aws_docs>\n\n`
    : '';
