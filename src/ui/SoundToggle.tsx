import { useState } from 'react';
import { isMuted, setMuted } from '@/game/audio';

export function SoundToggle() {
  const [muted, set] = useState(isMuted());
  return (
    <button
      className="btn icon"
      title={muted ? 'Sound off' : 'Sound on'}
      aria-label="Sound effects"
      aria-pressed={!muted}
      onClick={() => {
        setMuted(!muted);
        set(!muted);
      }}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}
