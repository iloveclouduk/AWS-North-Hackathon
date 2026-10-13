import type { ReactNode } from 'react';
import { Portrait } from './Portrait';

/** "Nothing here yet", said the same way everywhere: Connie (or an emoji), a short title, one line of what to do. */
export function EmptyState({ title, children, emoji }: { title: string; children: ReactNode; emoji?: string }) {
  return (
    <div className="empty-state">
      {emoji ? (
        <span className="sprite big-emoji" aria-hidden="true">
          {emoji}
        </span>
      ) : (
        <Portrait id="concierge" size={48} className="sprite" />
      )}
      <b>{title}</b>
      <span>{children}</span>
    </div>
  );
}
