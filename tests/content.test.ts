import { describe, expect, it } from 'vitest';
import { effectiveEdges, slotsOf } from '@/learning/diagram';
import { choiceOrder } from '@/world/content';
import { productName } from '@/world/icons';
import { CARDS, PILLARS, PUZZLES, QUESTS, TEMPLATES } from '@/world/content';
import { CARRIERS } from '@/world/carriers';
import { COMPARISONS } from '@/world/comparisons';
import { CITIZEN_LEVELS, CITIZENS, WA_RULES } from '@/world/citizens';
import { ALL_TERMS, GLOSSARY, serviceTerms, splitTerms, type GlossaryEntry, type TermToken } from '@/world/glossary';
import { PLACES } from '@/world/places';
import { SERVICES } from '@/world/taxonomy';
import world from '../shared/world.json' with { type: 'json' };

const ids = new Set(SERVICES.map((s) => s.id));

describe('learning content is complete and consistent', () => {
  it('every service has at least 8 flashcards with https docs sources and a tier mix', () => {
    for (const s of SERVICES) {
      const cards = CARDS[s.id] ?? [];
      expect(cards.length, s.id).toBeGreaterThanOrEqual(8);
      for (const c of cards) {
        // Flashcards.tsx derives the service from the id, so ids stay `<serviceId>-NN`.
        expect(c.id, c.id).toMatch(new RegExp(`^${s.id}-\\d{2}$`));
        expect(c.source, c.id).toMatch(/^https:\/\//);
        expect(c.q.length, c.id).toBeLessThanOrEqual(120);
        expect([1, 2, 3, 4]).toContain(c.tier);
      }
      expect(new Set(cards.map((c) => c.tier)).size, s.id).toBe(4);
    }
    const all = Object.values(CARDS).flat().map((c) => c.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it('puzzles only use real services and score all six pillars', () => {
    expect(PILLARS.map((p) => p.id).sort()).toEqual(['cost', 'operational', 'performance', 'reliability', 'security', 'sustainability']);
    for (const p of PUZZLES) {
      for (const s of [...p.required, ...p.optional, ...p.distractors, ...p.flow]) expect(ids.has(s), `${p.id}: ${s}`).toBe(true);
      expect(Object.keys(p.pillarBonus).length, p.id).toBe(6);
      for (const s of p.unneeded ?? []) expect(p.optional, `${p.id}: unneeded ${s} is a bonus service`).toContain(s);
      expect(p.required.some((s) => p.distractors.includes(s)), p.id).toBe(false);
    }
  });

  it('quests reference existing services, puzzles and templates', () => {
    const puzzles = new Set(PUZZLES.map((p) => p.id));
    const templates = new Set(TEMPLATES.map((t) => t.id));
    for (const q of QUESTS) {
      for (const st of q.steps) {
        if ('serviceId' in st) expect(ids.has(st.serviceId), `${q.id}`).toBe(true);
        if (st.kind === 'puzzle') expect(puzzles.has(st.puzzleId), q.id).toBe(true);
        if (st.kind === 'deploy') expect(templates.has(st.templateId), q.id).toBe(true);
      }
    }
    expect(QUESTS.filter((q) => q.steps.some((s) => s.kind === 'deploy')).length).toBe(TEMPLATES.length);
  });

  it('every service has a quest, and choose steps have one right answer, a reason for each option, and unique ids', () => {
    const covered = new Set(QUESTS.flatMap((q) => q.serviceIds));
    for (const id of ids) expect(covered.has(id), `${id} has no quest`).toBe(true);
    const seen = new Set<string>();
    for (const q of QUESTS)
      for (const st of q.steps) {
        if (st.kind !== 'choose') continue;
        expect(seen.has(st.id), st.id).toBe(false);
        seen.add(st.id);
        expect(st.options.length, st.id).toBeGreaterThanOrEqual(2);
        expect(st.options.length, st.id).toBeLessThanOrEqual(4);
        expect(st.options.filter((o) => o.correct).length, st.id).toBe(1);
        for (const o of st.options) {
          expect(o.why.length, `${st.id}: ${o.text}`).toBeGreaterThan(10);
          expect(o.why.length, `${st.id}: ${o.text}`).toBeLessThanOrEqual(220);
          expect(o.text, st.id).not.toMatch(/—/);
          expect(o.why, st.id).not.toMatch(/—/);
        }
      }
  });

  it('shuffles each question the same way every time, and the right answer moves about', () => {
    const steps = QUESTS.flatMap((q) => q.steps.flatMap((st) => (st.kind === 'choose' ? [st] : [])));
    const at = steps.map((st) => {
      const order = choiceOrder(st.id, st.options.length);
      expect(order).toEqual(choiceOrder(st.id, st.options.length));
      expect([...order].sort()).toEqual(st.options.map((_, i) => i));
      return order.indexOf(st.options.findIndex((o) => o.correct));
    });
    expect(new Set(at).size).toBeGreaterThan(1);
  });

  it('every puzzle has a complete, consistent architecture diagram', () => {
    const ACTORS = ['users', 'client', 'mobile', 'internet', 'admin', 'sources'];
    for (const p of PUZZLES) {
      const d = p.diagram;
      expect(d, p.id).toBeDefined();
      if (!d) continue;
      const nodeIds = d.nodes.map((n) => n.id);
      expect(new Set([...nodeIds, ...d.groups.map((g) => g.id)]).size, `${p.id}: unique ids`).toBe(nodeIds.length + d.groups.length);
      const placed = new Set<string>();
      const allowed = new Set([...p.required, ...p.optional]);
      for (const n of d.nodes) {
        const kinds = [n.service, n.actor, n.mirrorOf, n.fixed].filter(Boolean).length;
        expect(kinds, `${p.id}/${n.id}: exactly one of service, actor, mirrorOf, fixed`).toBe(1);
        // Fixed boxes and combined-landmark products are drawn with a named icon from the manifest.
        for (const id of [n.fixed, n.shows].filter(Boolean)) expect(productName(id!), `${p.id}/${n.id}: product ${id}`).toBeTruthy();
        if (n.shows) expect(n.service, `${p.id}/${n.id}: shows needs a service`).toBeTruthy();
        if (n.service) expect(allowed.has(n.service), `${p.id}/${n.id}: ${n.service} is required or optional`).toBe(true);
        for (const a of n.accepts ?? []) expect(allowed.has(a), `${p.id}/${n.id} accepts ${a}`).toBe(true);
        if (n.actor) expect(ACTORS).toContain(n.actor);
        if (n.mirrorOf) expect(nodeIds, `${p.id}/${n.id}`).toContain(n.mirrorOf);
        if (n.attachTo) expect(nodeIds, `${p.id}/${n.id}`).toContain(n.attachTo);
        expect(n.role.length, `${p.id}/${n.id} role`).toBeLessThanOrEqual(18);
        if (n.attachTo) continue;
        expect(n.x >= 0 && n.x < d.cols && n.y >= 0 && n.y < d.rows, `${p.id}/${n.id} inside the grid`).toBe(true);
        const cell = `${n.x},${n.y}`;
        expect(placed.has(cell), `${p.id}/${n.id}: one box per cell`).toBe(false);
        placed.add(cell);
      }
      for (const g of d.groups) {
        expect(g.x >= 0 && g.y >= 0 && g.x + g.w <= d.cols && g.y + g.h <= d.rows, `${p.id}/${g.id} inside the grid`).toBe(true);
        if (g.service) expect(allowed.has(g.service), `${p.id}/${g.id}`).toBe(true);
      }
      // Every required and optional service has somewhere to go; distractors never do, but each says why.
      const slotServices = new Set(slotsOf(p).map((s) => s.service));
      for (const s of allowed) expect(slotServices.has(s), `${p.id}: a spot for ${s}`).toBe(true);
      for (const s of p.distractors) {
        expect(slotServices.has(s), `${p.id}: ${s} is a distractor`).toBe(false);
        expect(d.rejects[s]?.length, `${p.id}: rejects.${s}`).toBeGreaterThan(0);
        expect(d.rejects[s].length, `${p.id}: rejects.${s}`).toBeLessThanOrEqual(100);
      }
      for (const e of d.edges) {
        expect(nodeIds, `${p.id}: edge from ${e.from}`).toContain(e.from);
        expect(nodeIds, `${p.id}: edge to ${e.to}`).toContain(e.to);
        expect(e.from === e.to, `${p.id}: ${e.from} loops`).toBe(false);
        expect(e.label.length, `${p.id}: ${e.from}→${e.to} label`).toBeLessThanOrEqual(24);
        expect(e.caption?.length ?? 0, `${p.id}: ${e.from}→${e.to} caption`).toBeLessThanOrEqual(90);
        if (e.step !== undefined) expect(Number.isInteger(e.step) && e.step > 0).toBe(true);
        if (e.step) expect(e.caption, `${p.id}: ${e.from}→${e.to} needs a caption`).toBeTruthy();
      }
      // Each required box is wired in, and a design with only the required services still flows end to end.
      const onEdge = new Set(d.edges.flatMap((e) => [e.from, e.to]));
      for (const n of d.nodes) if (n.service && p.required.includes(n.service) && !n.side && !n.attachTo) expect(onEdge.has(n.id), `${p.id}/${n.id} is wired`).toBe(true);
      const minimal = Object.fromEntries(slotsOf(p).filter((s) => s.required).map((s) => [s.id, s.service]));
      const stepped = effectiveEdges(d, minimal).filter((e) => e.step);
      const reached = new Set(d.nodes.filter((n) => n.actor).map((n) => n.id));
      for (let grew = true; grew; ) {
        grew = false;
        for (const e of stepped) if (reached.has(e.from) && !reached.has(e.to)) grew = !!reached.add(e.to);
      }
      for (const n of d.nodes) if (n.service && p.required.includes(n.service) && stepped.some((e) => e.from === n.id || e.to === n.id)) expect(reached.has(n.id), `${p.id}/${n.id} reachable`).toBe(true);
      // The city's flow follows the diagram's order.
      const firstStep = (svc: string) => Math.min(...d.edges.filter((e) => e.step && [e.from, e.to].some((id) => d.nodes.find((n) => n.id === id)?.service === svc)).map((e) => e.step!));
      const steps = p.flow.map(firstStep).filter(Number.isFinite);
      expect(steps, `${p.id}: flow order`).toEqual([...steps].sort((a, b) => a - b));
      for (const s of p.flow) expect(slotServices.has(s), `${p.id}: flow ${s} is drawn`).toBe(true);
    }
  });
});

describe('glossary', () => {
  it('entries are valid: unique names, plain short text, https AWS docs links', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(40);
    const names = new Map<string, string>();
    for (const g of GLOSSARY) {
      expect(g.term.trim(), g.term).toBe(g.term);
      expect(g.short.length, g.term).toBeGreaterThan(0);
      expect(g.short.length, g.term).toBeLessThanOrEqual(120);
      expect(g.short, g.term).not.toMatch(/—/);
      const u = new URL(g.url);
      expect(u.protocol, g.term).toBe('https:');
      expect(['docs.aws.amazon.com', 'aws.amazon.com'], g.term).toContain(u.hostname);
      // No name (term or alias) may belong to two entries, ignoring case, nor repeat within one.
      for (const n of [g.term, ...g.aliases]) {
        const key = n.toLowerCase();
        expect(names.get(key), `${n} is used by ${names.get(key)} and ${g.term}`).toBeUndefined();
        names.set(key, g.term);
      }
    }
  });

  const E = (term: string, aliases: string[] = []): GlossaryEntry => ({ term, aliases, short: term, url: 'https://docs.aws.amazon.com/' });
  const az = E('Availability Zone', ['AZ']);
  const multi = E('Multi-AZ');
  const vpc = E('VPC');
  const subnet = E('subnet');
  const imds = E('IMDSv2', ['IMDS']);
  const entries = [az, multi, vpc, subnet, imds];
  const linked = (tokens: TermToken[]) => tokens.flatMap((t) => (typeof t === 'string' ? [] : [t.text]));

  it('splits whole words only and keeps the text intact', () => {
    const text = 'Put the subnet in a VPC, not in subnetting or VPCX.';
    const out = splitTerms(text, entries);
    expect(out.map((t) => (typeof t === 'string' ? t : t.text)).join('')).toBe(text);
    expect(linked(out)).toEqual(['subnet', 'VPC']);
    expect(linked(splitTerms('aVPC VPC_1 xsubnet', entries))).toEqual([]);
  });

  it('links only the first mention of each entry, aliases included', () => {
    expect(linked(splitTerms('Each AZ is an Availability Zone. Use two AZs.', entries))).toEqual(['AZ']);
    expect(linked(splitTerms('A subnet, then subnets.', entries))).toEqual(['subnet']);
  });

  it('matches acronyms case-sensitively and other terms in any case', () => {
    expect(linked(splitTerms('the vpc and the az', entries))).toEqual([]);
    expect(linked(splitTerms('Subnet first', entries))).toEqual(['Subnet']);
    expect(linked(splitTerms('availability zones', entries))).toEqual(['availability zones']);
  });

  it('prefers the longest name and never matches inside a hyphenated word', () => {
    expect(linked(splitTerms('Multi-AZ keeps a standby in another AZ.', entries))).toEqual(['Multi-AZ', 'AZ']);
    expect(linked(splitTerms('Use IMDSv2, not IMDS.', entries))).toEqual(['IMDSv2']);
    expect(linked(splitTerms('Turn on IMDS v2', entries))).toEqual(['IMDS']);
    expect(linked(splitTerms('SSE-AZ and AZ-wide', entries))).toEqual([]);
  });

  it('finds real glossary terms in real app text', () => {
    expect(linked(splitTerms('On a miss, CloudFront fetches the file. OAC means only CloudFront can read the bucket.'))).toEqual(['OAC']);
  });
});

describe('plain language', () => {
  it('every service is a tappable term, built from the city data', () => {
    const terms = serviceTerms();
    for (const s of SERVICES) {
      const place = PLACES.find((p) => p.serviceId === s.id)!;
      const e = terms.find((t) => t.serviceId === s.id);
      expect(e, s.id).toBeDefined();
      expect([e!.term, ...e!.aliases], s.id).toContain(place.place);
      expect(e!.short, s.id).toBe(place.blurb);
      if (e!.url) expect(new URL(e!.url).protocol, s.id).toBe('https:');
    }
    // No name belongs to two entries, beginner glossary and services together.
    const seen = new Map<string, string>();
    for (const g of ALL_TERMS)
      for (const n of [g.term, ...g.aliases]) {
        expect(seen.get(n.toLowerCase()), `${n}: ${seen.get(n.toLowerCase())} and ${g.term}`).toBeUndefined();
        seen.set(n.toLowerCase(), g.term);
      }
    expect(linkedNames(splitTerms('Sally lives at S3 Lake and keeps S3 buckets.', ALL_TERMS))).toEqual(['S3 Lake']);
    // Service names match their case only: glue the word isn't AWS Glue.
    expect(linkedNames(splitTerms('Use glue, then Glue.', ALL_TERMS))).toEqual(['Glue']);
  });

  // What players read: quests, puzzle briefs, finding titles and texts, beginner flashcard questions, citizens, the glossary.
  const fields: [string, string][] = [
    ...QUESTS.flatMap((q) => [[`${q.id} title`, q.title], [`${q.id} intro`, q.intro], ...q.steps.map((st, i) => [`${q.id} step ${i + 1}`, st.text])] as [string, string][]),
    ...QUESTS.flatMap((q) =>
      q.steps.flatMap((st) => (st.kind === 'choose' ? [[`${st.id} question`, st.question], ...st.options.flatMap((o, i) => [[`${st.id} option ${i + 1}`, o.text], [`${st.id} why ${i + 1}`, o.why]])] : [])),
    ) as [string, string][],
    ...PUZZLES.flatMap((p) => [[`${p.id} title`, p.title], [`${p.id} story`, p.story], ...p.requirements.map((r) => [`${p.id} brief`, r])] as [string, string][]),
    ...WA_RULES.flatMap((r) => [[`${r.id} title`, r.title], [`${r.id} text`, r.text], [`${r.id} why`, r.why ?? ''], [`${r.id} fix`, r.fix?.title ?? '']] as [string, string][]),
    ...Object.values(CARDS)
      .flat()
      .filter((c) => c.tier === 1)
      .map((c) => [c.id, c.q] as [string, string]),
    ...CITIZENS.map((c) => [c.id, c.greeting] as [string, string]),
    ...CITIZEN_LEVELS.map((l) => [l.name, l.can] as [string, string]),
    ...GLOSSARY.map((g) => [`glossary ${g.term}`, g.short] as [string, string]),
    // Simple words first: every card's simple answer and every puzzle's simple why.
    ...Object.values(CARDS)
      .flat()
      .map((c) => [`${c.id} simple`, c.simple ?? ''] as [string, string]),
    ...PUZZLES.map((p) => [`${p.id} simpleWhy`, p.simpleWhy ?? ''] as [string, string]),
    // "Which one should I pick?" cards.
    ...COMPARISONS.flatMap((c) => [[`${c.id} title`, c.title], [`${c.id} simple`, c.simple], ...c.options.map((o) => [`${c.id} ${o.serviceId}`, o.pick])] as [string, string][]),
    // A tapped data carrier's card.
    ...Object.entries(CARRIERS).flatMap(([k, c]) => [[`carrier ${k} name`, c.name], [`carrier ${k} simple`, c.simple], [`carrier ${k} more`, c.more]] as [string, string][]),
  ];
  /** Acronym-like words: AZ, IMDSv2, DLQs, S3. */
  const ACRONYM = /\b[A-Z][A-Z0-9]{1,}[a-z0-9]*\b/g;
  /** Not AWS jargon a player has to look up. Keep this tiny: add a glossary entry instead. */
  const ALLOWED = new Set(['AWS', 'XP', 'OK']);
  const known = new Set(ALL_TERMS.flatMap((g) => [g.term, ...g.aliases]).flatMap((n) => n.split(/[^A-Za-z0-9]+/)));
  const explained = (w: string) => ALLOWED.has(w) || known.has(w) || (w.endsWith('s') && known.has(w.slice(0, -1)));

  it('every acronym players read is a glossary term, a service name or allow-listed', () => {
    const missing = fields.flatMap(([where, text]) => (text.match(ACRONYM) ?? []).filter((w) => !explained(w)).map((w) => `${w} (${where})`));
    expect(missing).toEqual([]);
  });

  it('every flashcard has a simple answer and every puzzle a simple why: short, and never the full text again', () => {
    for (const c of Object.values(CARDS).flat()) {
      expect(c.simple?.trim().length, `${c.id} simple`).toBeGreaterThan(10);
      expect(c.simple!.length, `${c.id} simple`).toBeLessThanOrEqual(110);
      expect(c.simple, c.id).not.toBe(c.a);
      expect(c.simple, c.id).not.toMatch(/—/);
    }
    for (const p of PUZZLES) {
      expect(p.simpleWhy?.trim().length, `${p.id} simpleWhy`).toBeGreaterThan(10);
      expect(p.simpleWhy!.length, `${p.id} simpleWhy`).toBeLessThanOrEqual(140);
      expect(p.simpleWhy!.length, p.id).toBeLessThan(p.why.length);
      expect(p.simpleWhy, p.id).not.toMatch(/—/);
    }
  });

  it('every service has a simple line: short, explained acronyms, no em dash', () => {
    for (const s of world.services as { id: string; simple?: string }[]) {
      expect(s.simple?.trim().length, `${s.id} simple`).toBeGreaterThan(10);
      expect(s.simple!.length, `${s.id} simple`).toBeLessThanOrEqual(90);
      expect(s.simple, s.id).not.toMatch(/—/);
      expect((s.simple!.match(ACRONYM) ?? []).filter((w) => !explained(w)), `${s.id} simple`).toEqual([]);
      expect(PLACES.find((p) => p.serviceId === s.id)?.simple, s.id).toBe(s.simple);
    }
  });

  it('metaphor names never borrow another vendor or product name (no "Bedrock Oracle")', () => {
    // A player can't tell a pun from a product: "Oracle", "Azure", "Foundry"… read as real offerings.
    const VENDOR = /\b(Oracle|Azure|Foundry|Google|GCP|Snowflake|Databricks|HashiCorp|Terraform|Kafka|Salesforce|OpenAI|Gemini|Copilot)\b/i;
    for (const s of world.services as { id: string; place?: string; agentName?: string; blurb?: string; simple?: string }[]) {
      for (const text of [s.place, s.agentName, s.blurb, s.simple]) expect(text ?? '', s.id).not.toMatch(VENDOR);
    }
    for (const q of QUESTS) expect(q.title, q.id).not.toMatch(VENDOR);
  });

  it('quest steps are short and start with a plain word', () => {
    for (const q of QUESTS)
      for (const st of q.steps) {
        expect(st.text.length, st.text).toBeLessThanOrEqual(80);
        expect(new RegExp(`^${ACRONYM.source}`).test(st.text), st.text).toBe(false);
      }
  });
});

const linkedNames = (tokens: TermToken[]) => tokens.flatMap((t) => (typeof t === 'string' ? [] : [t.text]));

describe('agent tips', () => {
  it('come from the deck, deeper as the landmark levels up, short, and keep numbers whole', async () => {
    const { tipFor, CARDS: cards } = await import('@/world/content');
    expect(tipFor('s3', 1, 1)).toMatch(/^99\.999999999% \(11 nines\) durability/);
    const t1 = new Set(Array.from({ length: 30 }, (_, i) => tipFor('s3', 1, i)));
    const t4 = new Set(Array.from({ length: 30 }, (_, i) => tipFor('s3', 4, i)));
    expect(t4.size).toBeGreaterThan(t1.size);
    for (const id of Object.keys(cards)) for (let i = 0; i < 12; i++) expect((tipFor(id, 4, i) ?? '').length, id).toBeLessThanOrEqual(260);
  });
});

describe('content freshness', () => {
  it('every content file says when it was last checked (asOf, YYYY-MM-DD, not in the future)', async () => {
    const files = ['flashcards', 'quests', 'puzzles', 'glossary', 'templates', 'minigames', 'dialogue', 'aws-health-services', 'demo-health', 'region-facts', 'prices'];
    for (const f of files) {
      const d = (await import(`../shared/${f}.json`, { with: { type: 'json' } })).default as { asOf?: string };
      expect(d.asOf, f).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(Date.parse(d.asOf!) <= Date.now() + 86_400_000, f).toBe(true);
    }
  });
});
