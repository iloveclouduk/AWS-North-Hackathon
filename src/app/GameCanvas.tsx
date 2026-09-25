import { useEffect, useRef } from 'react';
import { createGame } from '@/game/createGame';

export function GameCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return createGame(ref.current);
  }, []);
  return <div className="game" ref={ref} />;
}
