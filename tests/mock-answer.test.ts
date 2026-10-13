import { describe, expect, it } from 'vitest';
import { bestCards, keywords, OFFLINE_NOTE, offlineAnswer } from '@/backend/mockAnswer';
import { cardsFor } from '@/world/content';
import { placeFor } from '@/world/places';

// The offline demo answers from the asked building's own flashcards instead of one template for every question.
describe('offline demo answers', () => {
  it('keeps the words that matter', () => {
    expect(keywords('How do I make my buckets private?')).toEqual(['bucket', 'private']);
    expect(keywords('What is the cheapest storage class?')).toEqual(['cheapest', 'storage', 'class']);
  });

  it('answers different questions about one service differently, from its cards', () => {
    const s3 = { id: 's3', name: 'Amazon S3' };
    const a = offlineAnswer(s3, placeFor('s3'), 'What storage class is cheapest for archives?');
    const b = offlineAnswer(s3, placeFor('s3'), 'How do I block public access to a bucket?');
    expect(a).not.toBe(b);
    for (const text of [a, b]) {
      expect(text).toContain('Source: https://');
      expect(text.endsWith(OFFLINE_NOTE)).toBe(true);
    }
    const cards = cardsFor('s3');
    expect(cards.some((c) => a.includes(c.simple ?? c.a))).toBe(true);
  });

  it('ranks the card whose question matches best first', () => {
    const [best] = bestCards('lambda', 'What is a cold start?');
    expect(best?.q.toLowerCase()).toContain('cold start');
  });

  it('falls back to what the building teaches when nothing matches', () => {
    const text = offlineAnswer({ id: 's3', name: 'Amazon S3' }, placeFor('s3'), 'zzz qqq');
    expect(text).toContain(placeFor('s3')!.place);
    expect(text).toContain(OFFLINE_NOTE);
  });
});

describe('offline demo answers stay on topic', () => {
  it('one shared word is not an answer: it picks the card that covers the question', () => {
    const text = offlineAnswer({ id: 'ec2', name: 'Amazon EC2' }, placeFor('ec2'), 'How do I pick an instance size?');
    expect(text).not.toMatch(/security group/i); // shares only "instance" with the question
    expect(text).toMatch(/pick how big/i);
  });
});
