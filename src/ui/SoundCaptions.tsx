import { useEffect, useState } from 'react';
import { onCaption } from '@/game/audio';
import { useCity } from '@/state/store';

const SHOW_MS = 1800;

/** ⋯ → Sound captions: the last meaningful sound in words, in a corner pill (for players who can't hear it). */
export function SoundCaptions() {
  const on = useCity((s) => !!s.prefs.captions);
  const [text, setText] = useState<{ t: string; at: number }>();
  useEffect(() => (on ? onCaption((t) => setText({ t, at: Date.now() })) : undefined), [on]);
  useEffect(() => {
    if (!text) return;
    const id = setTimeout(() => setText(undefined), SHOW_MS);
    return () => clearTimeout(id);
  }, [text]);
  if (!on || !text) return null;
  // Visual only: screen-reader users hear the sound itself, so a live region would repeat it.
  return (
    <div className="sound-caption" aria-hidden="true">
      🔊 [{text.t}]
    </div>
  );
}
