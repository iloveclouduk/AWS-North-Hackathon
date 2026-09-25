import { useState } from 'react';
import { isMuted, setMuted } from '@/game/audio';

export function SoundToggle() {
  const [muted, set] = useState(isMuted());
  return (
    <button
      className="btn"
      title={muted ? 'Sound off' : 'Sound on'}
      onClick={() => {
        setMuted(!muted);
        set(!muted);
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
