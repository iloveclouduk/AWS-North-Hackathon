import { useCity } from '@/state/store';

/** Polite live region for info toasts; errors are announced assertively (role=alert). */
export function Toasts() {
  const toasts = useCity((s) => s.toasts);
  const dismiss = useCity((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast ${t.kind === 'error' ? 'error' : ''}`}
          role={t.kind === 'error' ? 'alert' : undefined}
          onClick={() => dismiss(t.id)}
          title="Dismiss"
        >
          <span aria-hidden="true">{t.icon}</span> <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
