import { useCity } from '@/state/store';

export function Toasts() {
  const toasts = useCity((s) => s.toasts);
  const dismiss = useCity((s) => s.dismissToast);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <button key={t.id} className="toast" onClick={() => dismiss(t.id)}>
          <span>{t.icon}</span> {t.text}
        </button>
      ))}
    </div>
  );
}
