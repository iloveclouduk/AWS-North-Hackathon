// Small, consistent feedback for the panels: the same soft sounds the city uses (src/game/audio.ts,
// which respects the mute toggle, sets every level and skips a sound the city just covered) and tiny
// hooks for "this just changed" animations. These answer the player's own presses.
import { useEffect, useRef, useState } from 'react';
import { blip, chime, click, sfx } from '@/game/audio';

export const feel = {
  /** Any ordinary press. */
  tap: () => click(),
  /** A prompt or question leaves for the agents. */
  send: () => blip('concierge'),
  good: () => chime(true),
  bad: () => chime(false),
  flip: () => sfx('card', { own: true }),
  win: () => sfx('levelup', { own: true }),
  /** Starting a quest: a soft rising chime (the quest jingle is for finishing one, CityScene onQuestDone). */
  questStart: () => chime(true),
  pop: () => sfx('pop', { own: true }),
};

/** True for `ms` after `value` goes up (an XP or count "bump"). */
export function useBump(value: number, ms = 360) {
  const [on, setOn] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    const up = value > prev.current;
    prev.current = value;
    if (!up) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return on;
}

/** Copy to the clipboard and say so for a moment: `[copied, copy]`. */
export function useCopy(ms = 1600): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      feel.tap();
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), ms);
    });
  };
  return [copied, copy];
}
