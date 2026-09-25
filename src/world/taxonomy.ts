// Districts (AWS categories) → services, read from shared/world.json (shared with the Python backend).
// Add a service there and it appears in the city. Nothing in game/ or ui/ hard-codes service ids.

import world from '../../shared/world.json';

export type DistrictId = 'storage' | 'compute' | 'database' | 'networking' | 'security' | 'aiml';

export interface District {
  id: DistrictId;
  name: string;
  /** Primary colour used for roofs, shirts, walls. */
  color: number;
  /** Name of the district HQ (the Habbo-style interior room). */
  hq: string;
  tagline: string;
}

export interface Service {
  id: string;
  name: string;
  districtId: DistrictId;
  /** Path segment after console.aws.amazon.com/ (e.g. "s3" matches /s3/buckets). */
  consolePaths: string[];
  /** Path segment after docs.aws.amazon.com/ (e.g. "AmazonS3"). */
  docsPaths: string[];
  /** Words that route a free-text prompt or page title to this service. */
  keywords: string[];
}

const hexToNum = (h: string) => parseInt(h.replace('#', ''), 16);

export const DISTRICTS: District[] = world.districts.map((d) => ({ ...d, id: d.id as DistrictId, color: hexToNum(d.color) }));

export const SERVICES: Service[] = world.services.map((s) => ({
  id: s.id,
  name: s.name,
  districtId: s.districtId as DistrictId,
  consolePaths: s.consolePaths,
  docsPaths: s.docsPaths,
  keywords: s.keywords,
}));

export const serviceById = (id: string) => SERVICES.find((s) => s.id === id);
export const districtById = (id: string) => DISTRICTS.find((d) => d.id === id);
export const servicesIn = (districtId: DistrictId) => SERVICES.filter((s) => s.districtId === districtId);

export type PageKind = 'console-home' | 'console' | 'docs' | 'other' | 'extension';

export interface PageMatch {
  kind: PageKind;
  serviceId?: string;
}

/** Map a browser URL to an AWS service. Longest matching path wins (so rds/aurora beats rds). */
export function matchUrl(rawUrl: string): PageMatch {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'other' };
  }
  if (url.protocol === 'chrome-extension:' || url.protocol === 'chrome:') return { kind: 'extension' };
  const host = url.hostname;
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const hash = url.hash.replace(/^#\/?/, '');

  const best = (field: 'consolePaths' | 'docsPaths', candidate: string) => {
    let winner: { id: string; len: number } | undefined;
    for (const s of SERVICES) {
      for (const p of s[field]) {
        const lower = p.toLowerCase();
        const c = candidate.toLowerCase();
        if ((c === lower || c.startsWith(lower + '/') || c.startsWith(lower + '?')) && (!winner || lower.length > winner.len)) {
          winner = { id: s.id, len: lower.length };
        }
      }
    }
    return winner?.id;
  };

  if (host === 'console.aws.amazon.com' || host.endsWith('.console.aws.amazon.com')) {
    if (path === '' || path.startsWith('console/home')) return { kind: 'console-home' };
    // Some consoles route via hash (e.g. /rds/home#aurora); try path + hash.
    const serviceId = best('consolePaths', path.split('/home')[0] + (hash ? '/' + hash : '')) ?? best('consolePaths', path);
    return { kind: 'console', serviceId };
  }
  if (host === 'docs.aws.amazon.com') return { kind: 'docs', serviceId: best('docsPaths', path) };
  return { kind: 'other' };
}

/** Keyword routing for free text (prompts, page titles). Returns best service id or undefined. */
export function matchText(text: string): string | undefined {
  const t = ` ${text.toLowerCase()} `;
  let winner: { id: string; score: number } | undefined;
  for (const s of SERVICES) {
    let score = 0;
    for (const k of s.keywords) if (t.includes(k)) score += k.length;
    if (score > 0 && (!winner || score > winner.score)) winner = { id: s.id, score };
  }
  return winner?.id;
}

export const hexColor = (n: number) => '#' + n.toString(16).padStart(6, '0');
