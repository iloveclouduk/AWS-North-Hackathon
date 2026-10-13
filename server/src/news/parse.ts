import map from '../../../shared/aws-health-services.json' with { type: 'json' };
import { neutralise } from '../knowledge/mcp.js';
import { serviceById, type AwsIncident, type AwsNewsItem } from '../world.js';

/**
 * Parsers for AWS's public feeds (contract v2.6). Everything in them is untrusted text: tags and control characters are
 * removed, lengths are capped, and links are kept only when they're AWS's own https pages. Nothing here is ever given
 * to a model.
 */

const HEALTH = map.health as Record<string, string[]>;
const PRODUCTS = map.products as Record<string, string[]>;
/** Whole phrases only: 'Amazon Q' must not match 'Amazon Quick'. */
const TITLES = Object.entries(map.titles as Record<string, string[]>).map(([id, phrases]) => [id, phrases.map((p) => new RegExp(`(^|[^A-Za-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`))] as const);

export const MAX_INCIDENTS = 12;
export const MAX_LOG = 6;
export const MAX_LOG_CHARS = 1200;
export const MAX_SERVICE_NAMES = 12;
export const MAX_NEWS = 15;

const known = (ids: string[] | undefined) => (ids ?? []).filter((id) => serviceById(id));
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const iso = (secs: number) => new Date(secs * 1000).toISOString();

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** HTML → plain text: entities decoded, tags dropped, then neutralised (so nothing tag-like survives). */
export const plain = (html: string, max: number) => {
  const decoded = html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]*>/g, ' ');
  return clip(neutralise(decoded), max);
};

/** Over `max`: cut at the last full sentence when that keeps most of the text, else at a word, never mid-word. */
export const clip = (text: string, max: number) => {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentence >= max * 0.6) return `${head.slice(0, sentence + 1)} …`;
  const word = head.lastIndexOf(' ');
  return `${(word >= max * 0.6 ? head.slice(0, word) : head).trimEnd()}…`;
};

const DIRECTION: Record<string, string> = { north: 'n', south: 's', east: 'e', west: 'w', central: 'c', northeast: 'ne', southeast: 'se', northwest: 'nw', southwest: 'sw' };
/** A Region's zone-ID prefix, as AWS names them: me-south-1 → mes1, ap-southeast-2 → apse2, us-east-1 → use1. */
export const zonePrefix = (region: string) => {
  const m = region.match(/^([a-z]{2})-([a-z]+)-(\d+)$/);
  const dir = m && DIRECTION[m[2]];
  return m && dir ? `${m[1]}${dir}${m[3]}` : undefined;
};

/** Zone IDs (e.g. mes1-az2, use1-az4) named in the text; with a Region, only that Region's own zones. */
export const azIdsIn = (text: string, region?: string) => {
  const prefix = region && zonePrefix(region);
  return uniq(text.match(/\b[a-z]{2,5}\d{1,2}-az\d{1,2}\b/g) ?? []).filter((id) => !prefix || id.startsWith(`${prefix}-`)).sort();
};

const REGION = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
const regionOf = (s: string | undefined) => (s && REGION.test(s) ? s : undefined);

/** The Health feed's body: UTF-16 (either byte order, with a BOM, as AWS serves it today) or UTF-8. */
export const decodeFeed = (bytes: Uint8Array): string => {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
};

const SEVERITY: Record<string, AwsIncident['severity']> = { '1': 'informational', '2': 'degradation', '3': 'disruption' };

interface RawHealth {
  date?: unknown;
  arn?: unknown;
  region_name?: unknown;
  status?: unknown;
  service?: unknown;
  service_name?: unknown;
  summary?: unknown;
  event_log?: { summary?: unknown; message?: unknown; status?: unknown; timestamp?: unknown }[];
  impacted_services?: Record<string, { service_name?: unknown; current?: unknown }>;
}

/** The Health service code without its Region suffix: 's3-me-south-1' → 's3'. */
const codeOf = (key: string, region: string | undefined) => (region && key.endsWith(`-${region}`) ? key.slice(0, -region.length - 1) : key);

/** health.aws.amazon.com/public/currentevents: open events only (resolved ones leave the feed). */
export const parseHealthJson = (text: string): AwsIncident[] => {
  const rows = JSON.parse(text) as unknown;
  if (!Array.isArray(rows)) throw new Error('health feed is not a list');
  const out: AwsIncident[] = [];
  for (const raw of rows as RawHealth[]) {
    if (!raw || typeof raw !== 'object' || typeof raw.arn !== 'string') continue;
    const arnRegion = raw.arn.split(':')[3];
    const service = typeof raw.service === 'string' ? raw.service : '';
    const region = regionOf(arnRegion) ?? regionOf(service.match(/-([a-z]{2}(?:-gov)?-[a-z]+-\d)$/)?.[1]) ?? 'global';
    const log = (Array.isArray(raw.event_log) ? raw.event_log : [])
      .filter((l) => typeof l?.message === 'string' && Number.isFinite(Number(l.timestamp)))
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    // Services still impacted (current 0 = recovered), else the event's own service.
    const impacted = Object.entries(raw.impacted_services ?? {}).filter(([, v]) => Number(v?.current) > 0);
    const codes = impacted.length ? impacted.map(([k]) => codeOf(k, region)) : [codeOf(service, region)];
    const names = impacted.length ? impacted.map(([, v]) => plain(String(v.service_name ?? ''), 80)).filter(Boolean) : [plain(String(raw.service_name ?? ''), 80)].filter(Boolean);
    const level = Math.max(Number(raw.status) || 0, ...impacted.map(([, v]) => Number(v.current) || 0));
    const started = Number(raw.date) || Number(log.at(-1)?.timestamp) || 0;
    const updated = Number(log[0]?.timestamp) || started;
    out.push({
      id: raw.arn.slice(0, 300),
      region,
      regionName: typeof raw.region_name === 'string' ? plain(raw.region_name, 40) : undefined,
      azIds: azIdsIn(log.map((l) => String(l.message)).join(' '), region),
      severity: SEVERITY[String(Math.min(3, Math.max(1, level)))],
      status: 'open',
      title: plain(String(log[0]?.summary ?? raw.summary ?? 'Service event'), 140),
      services: names.sort().slice(0, MAX_SERVICE_NAMES),
      serviceCount: names.length,
      serviceIds: uniq(codes.flatMap((c) => known(HEALTH[c]))).sort(),
      started: iso(started),
      updated: iso(updated),
      log: log.slice(0, MAX_LOG).map((l) => ({ at: iso(Number(l.timestamp)), text: plain(String(l.message), MAX_LOG_CHARS) })),
    });
  }
  return out.sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, MAX_INCIDENTS);
};

const tag = (item: string, name: string) => item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1];
const items = (xml: string) => xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

/**
 * status.aws.amazon.com/rss/all.rss, the fallback when the JSON can't be read. It's a history, so only the newest
 * item per event key (service-region) in the last 30 days counts, and '[RESOLVED]' items close their event.
 */
export const parseHealthRss = (xml: string, now = Date.now()): AwsIncident[] => {
  const latest = new Map<string, AwsIncident>();
  for (const item of items(xml)) {
    const guid = plain(tag(item, 'guid') ?? '', 300);
    const key = guid.split('#')[1]?.replace(/_\d+$/, '');
    const at = Date.parse(tag(item, 'pubDate') ?? '');
    if (!key || !Number.isFinite(at) || now - at > 30 * 24 * 60 * 60_000) continue;
    if ((latest.get(key)?.updated ?? '') >= new Date(at).toISOString()) continue;
    const region = regionOf(key.match(/-([a-z]{2}(?:-gov)?-[a-z]+-\d)$/)?.[1]) ?? 'global';
    const code = codeOf(key, region);
    const rawTitle = plain(tag(item, 'title') ?? '', 200);
    const text = plain(tag(item, 'description') ?? '', MAX_LOG_CHARS);
    const severity: AwsIncident['severity'] = /^service disruption/i.test(rawTitle) ? 'disruption' : /^(performance issues|service degradation|service impact)/i.test(rawTitle) ? 'degradation' : 'informational';
    latest.set(key, {
      id: guid,
      region,
      azIds: azIdsIn(text, region),
      severity,
      status: /\[resolved\]/i.test(rawTitle) ? 'resolved' : 'open',
      title: rawTitle.replace(/^\[resolved\]\s*/i, '').replace(/^(service disruption|performance issues|service degradation|service impact|informational message):\s*/i, '').slice(0, 140) || 'Service event',
      services: [],
      serviceCount: 0,
      serviceIds: uniq(known(HEALTH[code])),
      started: new Date(at).toISOString(),
      updated: new Date(at).toISOString(),
      log: [{ at: new Date(at).toISOString(), text }],
    });
  }
  return [...latest.values()].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, MAX_INCIDENTS);
};

/** Only AWS's own https pages are linked from the city. */
const awsUrl = (raw: string | undefined) => {
  try {
    const u = new URL(plain(raw ?? '', 500));
    return u.protocol === 'https:' && u.hostname === 'aws.amazon.com' && !u.username && !u.password ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

/** aws.amazon.com/about-aws/whats-new/recent/feed/: newest first. */
export const parseWhatsNew = (xml: string): AwsNewsItem[] => {
  const out: AwsNewsItem[] = [];
  for (const item of items(xml)) {
    const url = awsUrl(tag(item, 'link'));
    const title = plain(tag(item, 'title') ?? '', 160);
    const at = Date.parse(tag(item, 'pubDate') ?? '');
    if (!url || !title || !Number.isFinite(at)) continue;
    const products = (tag(item, 'category') ?? '').match(/general:products\/([a-z0-9-]+)/g)?.map((p) => p.slice('general:products/'.length)) ?? [];
    const byTitle = TITLES.filter(([, phrases]) => phrases.some((p) => p.test(title))).map(([id]) => id);
    out.push({
      id: plain(tag(item, 'guid') ?? url, 120),
      title,
      url,
      date: new Date(at).toISOString(),
      serviceIds: uniq([...products.flatMap((p) => known(PRODUCTS[p])), ...known(byTitle)]).sort(),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_NEWS);
};

/** Frames are at most 64 KB: older incidents keep only their latest update, then the oldest are dropped. */
export const FRAME_BUDGET = 48_000;
export const fitFrame = (incidents: AwsIncident[], budget = FRAME_BUDGET): AwsIncident[] => {
  const size = (xs: AwsIncident[]) => JSON.stringify(xs).length;
  let out = incidents;
  if (size(out) <= budget) return out;
  out = out.map((i, n) => (n < 2 ? i : { ...i, log: i.log.slice(0, 1) }));
  while (out.length > 1 && size(out) > budget) out = out.slice(0, -1);
  if (size(out) > budget) out = out.map((i) => ({ ...i, log: i.log.slice(0, 1) }));
  return out;
};
