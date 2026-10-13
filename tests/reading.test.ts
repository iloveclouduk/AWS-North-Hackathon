// "Learn more" (shared/further-reading.json): every service has a shelf, every link is https on a partner's own host,
// and books name their authors.
import { describe, expect, it } from 'vitest';
import { BOOKS, PARTNERS, READING, isReadingUrl, readingFor } from '@/world/reading';
import { SERVICES } from '@/world/taxonomy';

const ids = new Set(SERVICES.map((s) => s.id));

describe('reading shelf', () => {
  it('every service has a free cheat sheet, and nothing points at an unknown service', () => {
    for (const s of SERVICES) expect(READING[s.id]?.cheatSheet, s.id).toMatch(/^https:\/\/tutorialsdojo\.com\/[a-z0-9-]+\/$/);
    for (const id of Object.keys(READING)) expect(ids.has(id), id).toBe(true);
    for (const b of BOOKS) for (const s of b.services) expect(ids.has(s), `${b.id} ${s}`).toBe(true);
  });

  it('every link opens only on a partner host', () => {
    const urls = [
      ...Object.values(READING).flatMap((r) => [r.cheatSheet, r.articles].filter(Boolean) as string[]),
      ...BOOKS.map((b) => b.url),
      ...Object.values(PARTNERS).map((p) => p.home),
    ];
    for (const u of urls) expect(isReadingUrl(u), u).toBe(true);
    expect(isReadingUrl('http://tutorialsdojo.com/amazon-s3/')).toBe(false);
    expect(isReadingUrl('https://tutorialsdojo.com.evil.example/')).toBe(false);
    expect(isReadingUrl('https://user:pw@tutorialsdojo.com/')).toBe(false);
    expect(isReadingUrl('javascript:alert(1)')).toBe(false);
  });

  it('books are credited; free reading comes first', () => {
    for (const b of BOOKS) {
      expect(b.authors.length, b.id).toBeGreaterThan(3);
      if (b.isbn) expect(b.isbn).toMatch(/^97[89]\d{10}$/);
    }
    const lambda = readingFor('lambda');
    expect(lambda[0].partner).toBe('tutorialsdojo');
    expect(lambda.findIndex((l) => !l.free)).toBeGreaterThan(lambda.findIndex((l) => l.free));
    expect(lambda.some((l) => l.label.startsWith('Serverless Development on AWS'))).toBe(true);
    expect(readingFor('nope')).toEqual([]);
  });
});
