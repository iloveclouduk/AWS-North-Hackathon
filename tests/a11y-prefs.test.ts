// @vitest-environment jsdom
// Accessibility settings (⋯ → Accessibility): saved with the other prefs, read back strictly, applied as tokens.
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'aws-city-prefs';
const load = async () => (await import('@/state/store')).useCity;

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('accessibility prefs', () => {
  it('are saved and come back after a reload', async () => {
    let useCity = await load();
    useCity.getState().setPref('textSize', 150);
    useCity.getState().setPref('contrast', true);
    useCity.getState().setPref('easyFont', true);
    vi.resetModules();
    useCity = await load();
    expect(useCity.getState().prefs).toMatchObject({ textSize: 150, contrast: true, easyFont: true });
  });

  it('ignore anything else that was stored', async () => {
    localStorage.setItem(KEY, JSON.stringify({ chatter: false, stage: 'compact', textSize: 400, contrast: 'yes', easyFont: 1 }));
    const prefs = (await load()).getState().prefs;
    expect(prefs.textSize).toBeUndefined();
    expect(prefs.contrast).toBeUndefined();
    expect(prefs.easyFont).toBeUndefined();
  });

  it('every text size and mode only overrides tokens the base stylesheet defines', () => {
    const css = (f: string) => fs.readFileSync(path.resolve(__dirname, '../src/app/styles', f), 'utf8');
    const base = new Set(css('00-base.css').match(/--[a-z0-9-]+(?=:)/g));
    const overrides = css('22-access.css').match(/--[a-z0-9-]+(?=:)/g) ?? [];
    expect(overrides.length).toBeGreaterThan(10);
    for (const t of overrides) expect(base.has(t), t).toBe(true);
    for (const v of ['125', '150']) expect(css('22-access.css')).toContain(`:root[data-text='${v}']`);
  });
});

describe('games without a clock and sound captions', () => {
  it('are saved strictly, like the other settings', async () => {
    let useCity = await load();
    useCity.getState().setPref('relaxed', true);
    useCity.getState().setPref('captions', true);
    vi.resetModules();
    useCity = await load();
    expect(useCity.getState().prefs).toMatchObject({ relaxed: true, captions: true });
    localStorage.setItem(KEY, JSON.stringify({ relaxed: 'yes', captions: 1 }));
    vi.resetModules();
    const prefs = (await load()).getState().prefs;
    expect(prefs.relaxed).toBeUndefined();
    expect(prefs.captions).toBeUndefined();
  });

  it('relaxed play stretches reaction windows only when it is on', async () => {
    const useCity = await load();
    const { pace, relaxed } = await import('@/game/pace');
    expect(relaxed()).toBe(false);
    expect(pace(1100)).toBe(1100);
    useCity.getState().setPref('relaxed', true);
    expect(pace(1100)).toBe(2200);
    expect(pace(1100, 3)).toBe(3300);
  });

  it('every sound that means something has a caption; steps and blips do not', async () => {
    const { CAPTIONS } = await import('@/game/audio');
    for (const k of ['levelup', 'discover', 'deploy', 'quest', 'correct', 'wrong'] as const) expect(CAPTIONS[k]).toBeTruthy();
    expect(CAPTIONS.step0).toBeUndefined();
    expect(CAPTIONS.blip).toBeUndefined();
  });
});

describe('expert rounds', () => {
  it('open at building level 3, play quicker with the harder cards, and never mix with relaxed play', async () => {
    const useCity = await load();
    const { dealRound, expert, expertOpen, pace, setExpert } = await import('@/game/pace');
    const { TIER_XP } = await import('@/world/places');
    const { DNS_QUESTIONS } = await import('@/world/minigames');
    expect(expertOpen('route53')).toBe(false);
    const s = useCity.getState();
    useCity.setState({ view: { name: 'game', game: 'route53' } });
    s.discover('route53');
    useCity.getState().addXp('route53', TIER_XP[3]);
    expect(expertOpen('route53')).toBe(true);
    setExpert(true);
    expect(expert()).toBe(true);
    expect(pace(1000)).toBe(700);
    expect(dealRound(DNS_QUESTIONS, 0, 6).every((q) => q.tier >= 2)).toBe(true);
    useCity.getState().setPref('relaxed', true);
    expect(expert()).toBe(false);
    expect(expertOpen('route53')).toBe(false);
    expect(pace(1000)).toBe(2000);
    useCity.getState().setPref('relaxed', undefined);
    useCity.setState({ view: { name: 'city' } });
    expect(expert()).toBe(false); // leaving the game ends it
  });
});
