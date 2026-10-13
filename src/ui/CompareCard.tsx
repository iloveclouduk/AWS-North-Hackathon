import { useRef } from 'react';
import { openDocs } from '@/app/runtime';
import { comparisonById } from '@/world/comparisons';
import { placeFor } from '@/world/places';
import { serviceById } from '@/world/taxonomy';
import { AwsIcon } from './AwsIcon';
import { feel } from './feedback';
import { Plain } from './Term';
import { useDialog } from './useDialog';

/** "Which one should I pick?": a comparison of services people mix up, plain words first, the table one tap away. */
export function CompareCard({ id, onClose, onVisit }: { id?: string; onClose: () => void; onVisit: (serviceId: string) => void }) {
  const box = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const c = id ? comparisonById(id) : undefined;
  useDialog(!!c, box, onClose, closeBtn);
  if (!c) return null;
  const name = (s: string) => serviceById(s)?.name ?? s;
  return (
    <div className="finding-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} className="finding-card compare-card" role="dialog" aria-modal="true" aria-labelledby="compare-title">
        <header className="finding-head">
          <span className="incident-icon" aria-hidden="true">
            ⚖️
          </span>
          <div className="finding-who">
            <b id="compare-title">{c.title}</b>
            <span className="muted">Which one should I pick?</span>
          </div>
          <button ref={closeBtn} className="btn icon ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <p>
          <Plain text={c.simple} />
        </p>
        <ul className="compare-picks">
          {c.options.map((o) => (
            <li key={o.serviceId}>
              <button
                className="btn compare-pick"
                title={`Go to ${placeFor(o.serviceId)?.place ?? name(o.serviceId)}`}
                onClick={() => {
                  feel.tap();
                  onVisit(o.serviceId);
                }}
              >
                <AwsIcon serviceId={o.serviceId} size={24} />
                <span>
                  <b>{name(o.serviceId)}</b>
                  <span className="muted">
                    <Plain text={o.pick} still />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Compared on</span>
                </th>
                {c.options.map((o) => (
                  <th key={o.serviceId} scope="col">
                    {name(o.serviceId).replace(/^(Amazon|AWS) /, '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {c.options.map((o) => (
                    <td key={o.serviceId}>{r.values[o.serviceId]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn tiny" onClick={() => openDocs(c.source)}>
          Read the AWS guide ↗
        </button>
      </section>
    </div>
  );
}
