import { log } from '../log.js';
import type { AwsHealthEvent, AwsIncident, AwsNewsEvent, ServerEvent } from '../world.js';
import { decodeFeed, fitFrame, parseHealthJson, parseHealthRss, parseWhatsNew } from './parse.js';

/**
 * AWS's public status and news (contract v2.6), read once for the whole server and shared by every player: the
 * AWS Health Dashboard (no account, no credentials, no IAM) and What's New. No player data is ever sent anywhere.
 */
export const HEALTH_JSON_URL = 'https://health.aws.amazon.com/public/currentevents';
export const HEALTH_RSS_URL = 'https://status.aws.amazon.com/rss/all.rss';
export const WHATS_NEW_URL = 'https://aws.amazon.com/about-aws/whats-new/recent/feed/';

/** The only hosts the server ever fetches a feed from. */
export const FEED_HOSTS = new Set(['health.aws.amazon.com', 'status.aws.amazon.com', 'aws.amazon.com']);
export const MAX_FEED_BYTES = 4 * 1024 * 1024;

export const HEALTH_EVERY_MS = 3 * 60_000;
export const NEWS_EVERY_MS = 60 * 60_000;
/** After a failed read, wait this long before asking again. */
export const BACKOFF_MS = 15 * 60_000;
/** A resolved incident stays in the city for a day. */
export const RESOLVED_KEEP_MS = 24 * 60 * 60_000;

export type FetchBytes = (url: string) => Promise<Uint8Array>;

/** GET an allow-listed feed: https only, no redirects, a timeout and a size cap (checked while streaming). */
export const fetchFeed =
  (opts: { timeoutMs?: number; maxBytes?: number; fetch?: typeof fetch } = {}): FetchBytes =>
  async (url) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !FEED_HOSTS.has(u.hostname)) throw new Error(`feed host ${u.hostname} is not allowed`);
    const max = opts.maxBytes ?? MAX_FEED_BYTES;
    const res = await (opts.fetch ?? fetch)(u, { redirect: 'error', signal: AbortSignal.timeout(opts.timeoutMs ?? 5000), headers: { 'user-agent': 'aws-city/1.0 (+public status reader)' } });
    if (!res.ok) throw new Error(`feed status ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > max) throw new Error('feed too large');
    const reader = res.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        throw new Error('feed too large');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) (out.set(c, at), (at += c.byteLength));
    return out;
  };

export interface NewsFeed {
  /** The latest health and news events (nothing until the first read lands). */
  welcome(): ServerEvent[];
  /** Called with each change; the first subscriber starts the reads. */
  subscribe(fn: (events: ServerEvent[]) => void): () => void;
  /** Reads whatever is due now (the timer calls this; tests call it directly). */
  tick(): Promise<void>;
  stop(): void;
}

export const createNewsFeed = (opts: { fetchBytes?: FetchBytes; now?: () => number; tickMs?: number; news?: boolean } = {}): NewsFeed => {
  const now = opts.now ?? Date.now;
  const get = opts.fetchBytes ?? fetchFeed();
  const subscribers = new Set<(events: ServerEvent[]) => void>();
  let timer: NodeJS.Timeout | undefined;

  /** Every incident seen, by id; open ones that leave the feed become resolved and are kept for a day. */
  const known = new Map<string, AwsIncident>();
  let health: AwsHealthEvent | undefined;
  let healthHash = '';
  let healthDue = 0;
  let news: AwsNewsEvent | undefined;
  let newsHash = '';
  let newsDue = 0;
  let ticking: Promise<void> | undefined;

  const emit = (e: ServerEvent) => {
    for (const fn of subscribers) fn([e]);
  };

  const readHealth = async (): Promise<AwsIncident[]> => {
    try {
      return parseHealthJson(decodeFeed(await get(HEALTH_JSON_URL)));
    } catch (err) {
      log.warn('health json failed, trying rss', { err: (err as Error).message.slice(0, 80) });
      return parseHealthRss(decodeFeed(await get(HEALTH_RSS_URL)), now());
    }
  };

  const merge = (fresh: AwsIncident[]) => {
    const t = now();
    const seen = new Set(fresh.map((i) => i.id));
    for (const i of fresh) known.set(i.id, i);
    for (const [id, i] of known) {
      if (seen.has(id)) continue;
      if (i.status === 'open') known.set(id, { ...i, status: 'resolved', updated: new Date(t).toISOString() });
      else if (t - Date.parse(i.updated) > RESOLVED_KEEP_MS) known.delete(id);
    }
    return [...known.values()].sort((a, b) => (a.status === b.status ? b.updated.localeCompare(a.updated) : a.status === 'open' ? -1 : 1));
  };

  const tickHealth = async () => {
    if (now() < healthDue) return;
    try {
      const incidents = fitFrame(merge(await readHealth()));
      healthDue = now() + HEALTH_EVERY_MS;
      const hash = JSON.stringify(incidents);
      health = { type: 'aws.health', asOf: new Date(now()).toISOString(), incidents };
      if (hash !== healthHash) ((healthHash = hash), emit(health));
    } catch (err) {
      healthDue = now() + BACKOFF_MS;
      log.warn('health feed failed', { err: (err as Error).message.slice(0, 80) });
      // Keep what's known, marked stale, so the city doesn't pretend all is well or invent an outage.
      if (health && !health.stale) ((health = { ...health, stale: true }), (healthHash = ''), emit(health));
    }
  };

  const tickNews = async () => {
    if (opts.news === false || now() < newsDue) return;
    try {
      const items = parseWhatsNew(decodeFeed(await get(WHATS_NEW_URL)));
      newsDue = now() + NEWS_EVERY_MS;
      const hash = JSON.stringify(items);
      news = { type: 'aws.news', asOf: new Date(now()).toISOString(), items };
      if (hash !== newsHash) ((newsHash = hash), emit(news));
    } catch (err) {
      newsDue = now() + BACKOFF_MS;
      log.warn('whats new failed', { err: (err as Error).message.slice(0, 80) });
    }
  };

  const tick = () => (ticking ??= Promise.all([tickHealth(), tickNews()]).then(() => undefined).finally(() => (ticking = undefined)));

  return {
    welcome: () => [health, news].filter((e): e is AwsHealthEvent | AwsNewsEvent => !!e),
    subscribe(fn) {
      subscribers.add(fn);
      if (!timer) {
        void tick();
        timer = setInterval(() => void tick(), opts.tickMs ?? 30_000);
        timer.unref?.();
      }
      return () => subscribers.delete(fn);
    },
    tick,
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
};
