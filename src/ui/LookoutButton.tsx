import { grantLookout, setAutoSnap, snap, type Layout } from '@/app/runtime';
import { useCity } from '@/state/store';

/** The Lookout's camera: snap the current page so the city can see it. */
export function LookoutButton({ layout }: { layout: Layout }) {
  const state = useCity((s) => s.snap);
  const auto = useCity((s) => s.autoSnap);
  if (layout === 'full') return null; // the full-city tab can only see itself
  if (state === 'needs-permission') {
    return (
      <button type="button" className="btn warn" onClick={grantLookout} title="Chrome needs your OK before the Lookout can see pages">
        📷 Allow
      </button>
    );
  }
  return (
    <span className="lookout">
      <button type="button" className="btn" disabled={state === 'snapping'} onClick={() => void snap()} title="Lookout: show the city this page">
        {state === 'snapping' ? '⏳' : '📷'}
      </button>
      <label title="Snap automatically when you open a non-AWS page">
        <input type="checkbox" checked={auto} onChange={(e) => setAutoSnap(e.target.checked)} /> auto
      </label>
    </span>
  );
}
