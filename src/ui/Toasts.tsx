import type { CSSProperties } from 'react';
import { useCity } from '@/state/store';
import { Plain } from './Term';

/** Polite live region for info toasts; errors are announced assertively (role=alert). */
export function Toasts() {
  const toasts = useCity((s) => s.toasts);
  const dismiss = useCity((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        // The button keeps its role (an alert role would hide that it's clickable); errors are announced by the inner alert.
        <button
          key={t.id}
          className={`toast ${t.kind === 'error' ? 'error' : ''} ${t.leaving ? 'leaving' : ''}`}
          style={{ '--toast-ms': `${t.ms}ms` } as CSSProperties}
          onClick={() => dismiss(t.id)}
          title="Dismiss"
        >
          <span className="toast-icon" aria-hidden="true">
            {t.icon}
          </span>
          <span role={t.kind === 'error' ? 'alert' : undefined}>
            {/* Terms are marked, not buttons: the whole toast is the dismiss button. */}
            <Plain text={t.text} still />
          </span>
        </button>
      ))}
    </div>
  );
}
