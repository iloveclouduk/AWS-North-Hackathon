import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Progress } from '@/backend/contract';
import { builtCities, landmarkOf, migrateCities, withLandmark } from '@/state/cities';
import { mergeProgress } from '@/state/progress';
import { isDiscovered, tierOf, useCity } from '@/state/store';
import { FACTS } from '@/world/regions';

const base = (): Progress => ({ version: 2, landmarks: {}, updatedAt: '2026-10-10T10:00:00.000Z' });
const s = () => useCity.getState();

describe('each Region is its own city (contract v2.7)', () => {
  it('a Region landmark lives in that city only; a global one stands in every city', () => {
    let p = withLandmark(base(), 's3', 'us-west-2', { discovered: true, xp: 40 });
    p = withLandmark(p, 'iam', 'us-west-2', { discovered: true, xp: 10 });
    expect(isDiscovered(p, 's3', 'us-west-2')).toBe(true);
    expect(isDiscovered(p, 's3', 'eu-central-1')).toBe(false);
    expect(tierOf(p, 's3', 'eu-central-1')).toBe(-1);
    // IAM is global (shared/region-facts.json), so Frankfurt has it too.
    expect(FACTS.global).toContain('iam');
    expect(isDiscovered(p, 'iam', 'eu-central-1')).toBe(true);
    expect(p.landmarks.iam).toBeDefined();
    expect(p.landmarks.s3).toBeUndefined();
  });

  it('without a Region, a landmark is the best anywhere (what the player knows travels with them)', () => {
    let p = withLandmark(base(), 's3', 'us-west-2', { discovered: true, xp: 40 });
    p = withLandmark(p, 's3', 'eu-central-1', { discovered: true, xp: 5 });
    expect(landmarkOf(p, 's3')).toEqual({ discovered: true, xp: 40 });
    expect(builtCities(p)).toEqual({ 'us-west-2': 1, 'eu-central-1': 1 });
  });

  it('old saves move their Region landmarks into the city being built, once', () => {
    const old: Progress = { ...base(), landmarks: { s3: { discovered: true, xp: 12 }, route53: { discovered: true, xp: 2 } } };
    const p = migrateCities(old, 'us-west-2');
    expect(p.landmarks).toEqual({ route53: { discovered: true, xp: 2 } });
    expect(p.cities?.['us-west-2']?.landmarks.s3).toEqual({ discovered: true, xp: 12 });
    expect(migrateCities(p, 'us-west-2')).toBe(p);
  });

  it('two copies merge city by city, so nothing earned in either is lost', () => {
    const a = withLandmark(base(), 's3', 'us-west-2', { discovered: true, xp: 40 });
    const b = withLandmark({ ...base(), updatedAt: '2026-10-11T10:00:00.000Z' }, 'lambda', 'eu-central-1', { discovered: true, xp: 3 });
    const m = mergeProgress(a, b);
    expect(m.cities?.['us-west-2']?.landmarks.s3?.xp).toBe(40);
    expect(m.cities?.['eu-central-1']?.landmarks.lambda?.xp).toBe(3);
  });
});

describe('the store builds in the city you are in', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    s().resetSession();
  });
  afterEach(() => {
    s().resetSession();
    vi.useRealTimers();
  });

  it('a new Region starts from zero', () => {
    useCity.setState({ cityRegion: 'us-west-2' });
    s().addXp('s3', 15);
    expect(isDiscovered(s().progress, 's3', 'us-west-2')).toBe(true);
    useCity.setState({ cityRegion: 'eu-central-1' });
    expect(isDiscovered(s().progress, 's3', 'eu-central-1')).toBe(false);
    s().addXp('s3', 2);
    expect(landmarkOf(s().progress, 's3', 'eu-central-1')?.xp).toBe(2);
    expect(landmarkOf(s().progress, 's3', 'us-west-2')?.xp).toBe(15);
  });

  it('loading an old save migrates it', () => {
    useCity.setState({ cityRegion: 'us-west-2' });
    s().loadProgress({ ...base(), landmarks: { s3: { discovered: true, xp: 12 } } });
    expect(s().progress.cities?.['us-west-2']?.landmarks.s3?.xp).toBe(12);
  });
});
