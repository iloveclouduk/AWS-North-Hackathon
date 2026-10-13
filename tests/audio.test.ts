// @vitest-environment jsdom
// The sound mixer (src/game/audio.ts) against a fake Phaser sound manager and AudioContext.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Audio = typeof import('@/game/audio');

class FakeParam {
  value = 1;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime = vi.fn();
  cancelScheduledValues() {}
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  onended: (() => void) | null = null;
  connect<T>(n: T) {
    return n;
  }
  disconnect() {}
  start() {}
  stop() {}
}

function fakeGame(state: AudioContextState = 'running') {
  const oscillators: FakeNode[] = [];
  const gains: FakeNode[] = [];
  const context = {
    state,
    currentTime: 0,
    createOscillator: () => {
      const o = new FakeNode();
      oscillators.push(o);
      return o;
    },
    createGain: () => {
      const g = new FakeNode();
      gains.push(g);
      return g;
    },
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    suspend: vi.fn(async () => {
      context.state = 'suspended';
    }),
  };
  const sound = { context, destination: new FakeNode(), mute: false, pauseOnBlur: true, play: vi.fn(() => true) };
  const game = { sound, events: { once: vi.fn() } };
  return { game, context, sound, oscillators, gains };
}

let clock = 10_000;
let hidden = false;
let focused = true;

async function load(state: AudioContextState = 'running') {
  vi.resetModules();
  const audio: Audio = await import('@/game/audio');
  const f = fakeGame(state);
  audio.attachAudio(f.game as never);
  return { audio, ...f };
}

const press = () => window.dispatchEvent(new Event('pointerdown'));
const tick = (ms: number) => (clock += ms);

beforeEach(() => {
  clock = 10_000;
  hidden = false;
  focused = true;
  localStorage.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});
afterEach(() => vi.restoreAllMocks());

describe('mute', () => {
  it('persists in localStorage and is read back on load', async () => {
    const { audio, sound } = await load();
    expect(audio.isMuted()).toBe(false);
    audio.setMuted(true);
    expect(localStorage.getItem('aws-city.sfx')).toBe('off');
    expect(sound.mute).toBe(true);
    const again = await load();
    expect(again.audio.isMuted()).toBe(true);
    expect(again.sound.mute).toBe(true);
  });

  it('follows another surface through the storage event', async () => {
    const { audio, sound } = await load();
    const seen: boolean[] = [];
    audio.onMuteChange((m) => seen.push(m));
    localStorage.setItem('aws-city.sfx', 'off');
    window.dispatchEvent(new StorageEvent('storage', { key: 'aws-city.sfx', newValue: 'off' }));
    expect(audio.isMuted()).toBe(true);
    expect(sound.mute).toBe(true);
    window.dispatchEvent(new StorageEvent('storage', { key: 'aws-city.sfx', newValue: 'on' }));
    expect(audio.isMuted()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('plays nothing while muted', async () => {
    const { audio, sound, oscillators } = await load();
    audio.setMuted(true);
    press();
    audio.click();
    audio.sfx('levelup');
    expect(oscillators).toHaveLength(0);
    expect(sound.play).not.toHaveBeenCalled();
  });
});

describe('when sound may play', () => {
  it('drops (never queues) sounds before the context is unlocked, then unlocks on the first press', async () => {
    const { audio, context, sound, oscillators } = await load('suspended');
    audio.blip('concierge');
    audio.chime();
    audio.sfx('discover');
    expect(oscillators).toHaveLength(0);
    expect(sound.play).not.toHaveBeenCalled();
    press();
    expect(context.resume).toHaveBeenCalled();
    await Promise.resolve();
    expect(context.state).toBe('running');
    tick(1000);
    audio.sfx('discover');
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('plays nothing while the document is hidden, and suspends the context', async () => {
    const { audio, context, sound, oscillators } = await load();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(context.suspend).toHaveBeenCalled();
    audio.click();
    audio.blip('lookout');
    audio.sfx('quest');
    expect(oscillators).toHaveLength(0);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('keeps ambient sounds to the focused surface, but answers presses anywhere', async () => {
    const { audio, sound } = await load();
    focused = false;
    // Another surface took the lead.
    const other = new BroadcastChannel('aws-city.audio');
    other.postMessage({ lead: 'someone-else' });
    await new Promise((r) => setTimeout(r, 20));
    other.close();
    tick(5000);
    audio.sfx('deploy');
    expect(sound.play).not.toHaveBeenCalled();
    press();
    audio.sfx('deploy');
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('turns off Phaser pause-on-blur and survives a destroyed game', async () => {
    const { audio, sound } = await load();
    expect(sound.pauseOnBlur).toBe(false);
    (sound as { destination: unknown }).destination = null; // what Phaser leaves after destroy()
    expect(() => audio.sfx('pop')).not.toThrow();
    expect(sound.play).not.toHaveBeenCalled();
  });
});

describe('mixer', () => {
  it('skips a lower-priority sound while a bigger clip plays (for the clip’s own length)', async () => {
    const { audio, sound, oscillators } = await load();
    press();
    audio.sfx('levelup');
    expect(sound.play).toHaveBeenCalledTimes(1);
    tick(50);
    audio.blip('lambda');
    audio.click();
    audio.chime();
    audio.sfx('correct', { own: true });
    expect(oscillators).toHaveLength(0);
    expect(sound.play).toHaveBeenCalledTimes(1);
    tick(1000); // the fanfare is still playing
    audio.click();
    expect(oscillators).toHaveLength(0);
    tick(800);
    audio.click();
    expect(oscillators).toHaveLength(1);
  });

  it('fades a lower voice that just started when a higher sound arrives', async () => {
    const { audio, gains } = await load();
    press();
    audio.blip('lambda');
    const out = gains[0];
    tick(30);
    audio.chime();
    expect(out.gain.linearRampToValueAtTime).toHaveBeenCalled();
  });

  it('throttles clicks', async () => {
    const { audio, oscillators } = await load();
    press();
    audio.click();
    tick(20);
    audio.click();
    expect(oscillators).toHaveLength(1);
    tick(100);
    audio.click();
    expect(oscillators).toHaveLength(2);
  });

  it('blips one at a time across the city, each speaker in their own fixed note', async () => {
    const { audio, oscillators } = await load();
    press();
    audio.blip('lambda');
    audio.blip('s3');
    expect(oscillators).toHaveLength(2); // two notes per blip; the second speaker waits its turn
    tick(600);
    audio.blip('s3');
    expect(oscillators).toHaveLength(4);
    expect(audio.blipNote('lambda')).toBe(audio.blipNote('lambda'));
    expect(new Set(['lambda', 's3', 'ec2', 'iam', 'bedrock'].map(audio.blipNote)).size).toBeGreaterThan(2);
  });

  it('captions the synth chimes too', async () => {
    const { audio } = await load();
    const heard: string[] = [];
    audio.onCaption((t) => heard.push(t));
    press();
    audio.chime(true);
    tick(1000);
    audio.chime(false);
    expect(heard).toEqual(['Notification chime', 'Soft low chime']);
  });

  it('fades the master out before muting (no click), and unmutes cleanly', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { audio, sound } = await load();
    const node = new FakeNode();
    (sound as unknown as { masterMuteNode: FakeNode }).masterMuteNode = node;
    audio.setMuted(true);
    expect(node.gain.linearRampToValueAtTime).toHaveBeenCalled();
    expect(sound.mute).toBe(false); // still fading
    vi.advanceTimersByTime(50);
    expect(sound.mute).toBe(true);
    audio.setMuted(false);
    expect(sound.mute).toBe(false);
    vi.useRealTimers();
  });

  it('reads levels from its table and never plays the long step sample', async () => {
    const { audio, sound } = await load();
    press();
    audio.sfx('step2', 0.15);
    expect(sound.play).toHaveBeenCalledWith('sfx:step0', expect.objectContaining({ volume: expect.any(Number) }));
    tick(500);
    audio.sfx('card', 0.35);
    const vol = (sound.play.mock.calls[1] as unknown[])[1] as { volume: number };
    // Lifted from its quiet average, but held down for its spiky attack (the loudest peak in the game at 0.9).
    expect(vol.volume).toBeGreaterThan(0.2);
    expect(vol.volume).toBeLessThan(0.4);
  });

  it('plays timer-driven outcomes softer than the player’s own', async () => {
    const { audio, sound } = await load();
    press();
    audio.sfx('correct', { own: true });
    tick(1000);
    audio.sfx('correct', { soft: true });
    const [own, soft] = sound.play.mock.calls.map((c) => ((c as unknown[])[1] as { volume: number }).volume);
    expect(soft).toBeLessThan(own);
  });
});
