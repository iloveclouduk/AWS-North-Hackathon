// On a landmark's card: whether AWS offers the service in the Region this city is, and what it costs there
// (list prices from shared/prices.json), plus what the player spent on it this month when their bill is on.
import { useCity } from '@/state/store';
import {
  availability, compare, monthlyNote, isGlobalService, nearestOffering, perUnit, pricesFor, PRICES, regionInfo, statusText,
} from '@/world/regions';
import { BillLine } from './BillLine';

export function RegionPrice({ serviceId }: { serviceId: string }) {
  const region = useCity((s) => s.cityRegion);
  const enterRegion = useCity((s) => s.enterRegion);
  const r = regionInfo(region);
  const a = availability(serviceId, region);
  const prices = pricesFor(serviceId, region).slice(0, 3);
  const city = r?.city ?? region;

  if (a.status !== 'available') {
    const near = nearestOffering(serviceId, region, 2);
    return (
      <div className="region-price closed">
        <b>⛔ Not offered in {city} ({region})</b> <span className="muted">· {statusText(a)}</span>
        {a.extra?.length ? (
          <ul className="muted small">
            {a.extra.map((x) => (
              <li key={x.product}>
                {x.product}: {statusText(x)}
              </li>
            ))}
          </ul>
        ) : null}
        {near.length ? (
          <div className="actions quiet">
            {near.map((n) => (
              <button key={n.code} className="btn ghost tiny" onClick={() => enterRegion(n.code)}>
                Go to {n.city} ({n.code}) →
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="region-price">
      <div className="muted small">
        {isGlobalService(serviceId) ? 'A global service: one for every Region.' : `In ${city} (${region})`}
        {a.note ? ` · ${a.note}` : ''}
        {a.extra?.some((x) => x.status !== 'available') ? ` · ${a.extra.filter((x) => x.status !== 'available').map((x) => `${x.product}: ${statusText(x)}`).join(' · ')}` : ''}
      </div>
      {prices.length ? (
        <ul className="prices">
          {prices.map((p) => {
            const vs = compare(p.key, region);
            return (
              <li key={p.key}>
                {p.label}: <b>{perUnit(p)}</b>
                {p.unit === 'hour' ? <span className="muted"> ({monthlyNote(p)})</span> : null}
                {vs ? <span className="muted"> · {Math.abs(vs)}% {vs > 0 ? 'above' : 'below'} us-east-1</span> : null}
              </li>
            );
          })}
          <li className="muted small">
            List price, USD, as of {PRICES.asOf}.{' '}
            <a className="src" href={prices[0].source} target="_blank" rel="noreferrer">
              Pricing ↗
            </a>
          </li>
        </ul>
      ) : null}
      <BillLine serviceId={serviceId} />
    </div>
  );
}
