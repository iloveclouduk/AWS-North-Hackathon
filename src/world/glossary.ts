// Tap-to-define glossary: beginner terms (shared/glossary.json) and the pure splitter that finds them in text.
import glossaryJson from '../../shared/glossary.json' with { type: 'json' };
import { CARDS } from './content';
import { placeFor } from './places';
import { SERVICES } from './taxonomy';

export interface GlossaryEntry {
  term: string;
  aliases: string[];
  /** One plain sentence or two, at most 120 characters. */
  short: string;
  /** An AWS documentation page (https, docs.aws.amazon.com or aws.amazon.com). */
  url: string;
  /** Match every name case-sensitively (service names: "Glue" the service, not "glue" the word). */
  exact?: boolean;
  /** The service this entry names (service entries only). */
  serviceId?: string;
}

export const GLOSSARY: GlossaryEntry[] = (glossaryJson as { terms: GlossaryEntry[] }).terms;

const bare = (name: string) => name.replace(/^(Amazon|AWS) /, '');

/**
 * One entry per service, from the city's own data: the service's name, its short names ("SQS", "SNS") and its place
 * ("S3 Lake") as aliases, the place's blurb as the definition, and the docs page its first beginner flashcard cites.
 * Names the beginner glossary already defines stay with it.
 */
export function serviceTerms(): GlossaryEntry[] {
  const taken = new Set(GLOSSARY.flatMap((g) => [g.term, ...g.aliases]).map((n) => n.toLowerCase()));
  const out: GlossaryEntry[] = [];
  for (const s of SERVICES) {
    const place = placeFor(s.id);
    if (!place) continue;
    // "Amazon SQS & SNS" → "SQS", "SNS"; one-letter names ("Q") would match too much.
    const names = [s.name, ...s.name.split(' & ').map(bare), place.place].filter((n) => n.length > 1 && !taken.has(n.toLowerCase()));
    const unique = [...new Set(names)];
    if (!unique.length) continue;
    for (const n of unique) taken.add(n.toLowerCase());
    const url = (CARDS[s.id] ?? []).find((c) => c.tier === 1)?.source ?? '';
    out.push({ term: unique[0], aliases: unique.slice(1), short: place.blurb, url, exact: true, serviceId: s.id });
  }
  return out;
}

/** The beginner glossary plus every service: what `<Plain>` links. */
export const ALL_TERMS: GlossaryEntry[] = [...GLOSSARY, ...serviceTerms()];

const without = new Map<string, GlossaryEntry[]>();
/** ALL_TERMS minus one service (a flashcard about S3 shouldn't define S3 on its question side). Stable per id. */
export function termsWithout(serviceId: string): GlossaryEntry[] {
  let list = without.get(serviceId);
  if (!list) without.set(serviceId, (list = ALL_TERMS.filter((e) => e.serviceId !== serviceId)));
  return list;
}

/** A piece of text: plain, or a term to link (with the entry it defines). */
export type TermToken = string | { text: string; entry: GlossaryEntry };

/** Acronym-like names (two capitals in a row: AZ, IMDSv2, SSE-S3, KMS key) match case-sensitively; the rest ignore case. */
export const isCaseSensitive = (name: string) => /[A-Z]{2}/.test(name);

interface Name {
  text: string;
  lower: string;
  cs: boolean;
  entry: GlossaryEntry;
}

const namesOf = (entries: GlossaryEntry[]): Name[] =>
  entries
    .flatMap((entry) => [entry.term, ...entry.aliases].map((text) => ({ text, lower: text.toLowerCase(), cs: !!entry.exact || isCaseSensitive(text), entry })))
    // Longest first, so "Multi-AZ" wins over "AZ" and "AWS KMS key" over "KMS key".
    .sort((a, b) => b.text.length - a.text.length);

const WORD = /[A-Za-z0-9_]/;
const isWord = (c: string | undefined) => !!c && WORD.test(c);
/** Hyphens join words ("Multi-AZ", "SSE-S3"), so a name never starts or ends inside one. */
const gluedBefore = (s: string, i: number) => isWord(s[i - 1]) || (s[i - 1] === '-' && isWord(s[i - 2]));
const gluedAfter = (s: string, j: number) => isWord(s[j]) || (s[j] === '-' && isWord(s[j + 1]));

const cache = new WeakMap<GlossaryEntry[], Name[]>();

/**
 * Splits text into plain strings and glossary terms: whole words only, acronyms case-sensitive,
 * an optional plural "s", and only the first mention of each entry is linked.
 */
export function splitTerms(text: string, entries: GlossaryEntry[] = GLOSSARY): TermToken[] {
  let names = cache.get(entries);
  if (!names) cache.set(entries, (names = namesOf(entries)));
  const out: TermToken[] = [];
  const seen = new Set<GlossaryEntry>();
  const lower = text.toLowerCase();
  let plain = '';
  let i = 0;
  while (i < text.length) {
    let hit: { len: number; name: Name } | undefined;
    if (!gluedBefore(text, i)) {
      for (const n of names) {
        const at = n.cs ? text.startsWith(n.text, i) : lower.startsWith(n.lower, i);
        if (!at) continue;
        let len = n.text.length;
        if (text[i + len] === 's' && !gluedAfter(text, i + len + 1)) len++;
        else if (gluedAfter(text, i + len)) continue;
        hit = { len, name: n };
        break;
      }
    }
    if (!hit) {
      plain += text[i++];
      continue;
    }
    const word = text.slice(i, i + hit.len);
    i += hit.len;
    if (seen.has(hit.name.entry)) {
      plain += word;
      continue;
    }
    seen.add(hit.name.entry);
    if (plain) out.push(plain);
    plain = '';
    out.push({ text: word, entry: hit.name.entry });
  }
  if (plain) out.push(plain);
  return out;
}
