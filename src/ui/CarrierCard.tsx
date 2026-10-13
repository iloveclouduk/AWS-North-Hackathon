import { useEffect, useRef, useState } from 'react';
import { openDocs } from '@/app/runtime';
import { bus } from '@/state/bus';
import { CARRIERS, type Cargo } from '@/world/carriers';
import { feel } from './feedback';
import { ForLearners, Plain } from './Term';
import { useDialog } from './useDialog';

const ICON = { tanker: '🛢️', armoured: '🛡️', request: '📨', courier: '📦' } as const;

/**
 * A tapped data carrier: what kind of data it is (a real DataLink of the account, or an agent's call), where it's
 * going, and what that trip costs at list price. Data carriers are the city's only vehicles that mean something.
 */
export function CarrierCard() {
  const [cargo, setCargo] = useState<Cargo>();
  const box = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(
    () =>
      bus.on('carrierTap', ({ cargo }) => {
        feel.tap();
        setCargo(cargo);
      }),
    [],
  );
  const close = () => setCargo(undefined);
  useDialog(!!cargo, box, close, closeBtn);
  if (!cargo) return null;
  const c = CARRIERS[cargo.kind];
  return (
    <div className="finding-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && close()}>
      <section ref={box} className="finding-card carrier-card" role="dialog" aria-modal="true" aria-labelledby="carrier-title">
        <header className="finding-head">
          <span className="incident-icon" aria-hidden="true">
            {ICON[cargo.kind]}
          </span>
          <div className="finding-who">
            <b id="carrier-title">{c.name}</b>
            <span className="muted">
              {cargo.label} · {cargo.route}
            </span>
          </div>
          <button ref={closeBtn} className="btn icon ghost" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>
        <p>
          <Plain text={c.simple} />
        </p>
        {cargo.cost && <p className="muted">{cargo.cost}</p>}
        <ForLearners>
          <p>
            <Plain text={c.more} />
          </p>
          <button className="btn tiny" onClick={() => openDocs(c.source)}>
            Read the AWS docs ↗
          </button>
        </ForLearners>
      </section>
    </div>
  );
}
