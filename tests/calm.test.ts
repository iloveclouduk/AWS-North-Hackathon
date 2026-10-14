import { describe, expect, it } from 'vitest';
import { AUTO_PAN_QUIET_MS, mayAutoPan, mayShowBubble } from '@/game/calm';

describe('the camera waits for the player', () => {
  it('moves on its own only 8 s after the last input', () => {
    expect(AUTO_PAN_QUIET_MS).toBe(8000);
    expect(mayAutoPan(10_000, -Infinity)).toBe(true);
    expect(mayAutoPan(10_000, 5_000)).toBe(false);
    expect(mayAutoPan(13_000, 5_000)).toBe(true);
    expect(mayAutoPan(5_500, 5_000, 400)).toBe(true);
  });
});

describe('one bubble at a time', () => {
  it('alerts and answers always show', () => {
    for (const visible of [0, 1, 5]) for (const chatter of [false, true]) {
      expect(mayShowBubble('alert', visible, chatter)).toBe(true);
      expect(mayShowBubble('normal', visible, chatter)).toBe(true);
    }
  });

  it('ambient lines need chatter on and nobody else talking', () => {
    expect(mayShowBubble('ambient', 0, false)).toBe(false);
    expect(mayShowBubble('ambient', 0, true)).toBe(true);
    expect(mayShowBubble('ambient', 1, true)).toBe(false);
  });
});
