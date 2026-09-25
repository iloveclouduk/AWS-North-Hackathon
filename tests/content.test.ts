import { describe, expect, it } from 'vitest';
import { CARDS, PILLARS, PUZZLES, QUESTS, TEMPLATES } from '@/world/content';
import { SERVICES } from '@/world/taxonomy';

const ids = new Set(SERVICES.map((s) => s.id));

describe('learning content is complete and consistent', () => {
  it('every service has 8 flashcards with https docs sources and a tier mix', () => {
    for (const s of SERVICES) {
      const cards = CARDS[s.id] ?? [];
      expect(cards.length, s.id).toBe(8);
      for (const c of cards) {
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
});
