// The player's own month-to-date AWS bill (contract v2.5 city.bill), opt-in: Cost Explorer charges the account
// $0.01 per request, so it's read only after the player turns it on, then at most once a day.
import { setBill } from '@/app/runtime';
import { useCity } from '@/state/store';
import { usd } from '@/world/regions';

/** The bill for a Region (`region`) or one service (`serviceId`), with the on/off switch. */
export function BillLine({ region, serviceId }: { region?: string; serviceId?: string }) {
  const on = useCity((s) => s.billOn);
  const bill = useCity((s) => s.bill);
  const linked = useCity((s) => s.account.linked);
  if (!linked) return null;
  if (!on)
    return (
      <div className="bill-line muted small">
        <button className="btn ghost tiny" onClick={() => setBill(true)}>
          🧾 Show my bill
        </button>{' '}
        Reads this month's costs from Cost Explorer once a day (AWS charges $0.01 a read).
      </div>
    );
  if (!bill) return <div className="bill-line muted small">🧾 Reading your bill…</div>;
  if (bill.unavailable !== undefined) return <div className="bill-line muted small">🧾 {bill.unavailable}</div>;
  const amount = serviceId ? (bill.byService[serviceId] ?? 0) : region ? (bill.byRegion[region] ?? 0) : bill.total;
  const what = serviceId ? 'on this service' : region ? `in ${region}` : 'in total';
  return (
    <div className="bill-line small">
      🧾 This month {what}: <b>{usd(amount)}</b>{' '}
      <span className="muted">
        of {usd(bill.total)} ({bill.month} so far, estimated).{' '}
        <button className="btn ghost tiny" onClick={() => setBill(false)}>
          Hide
        </button>
      </span>
    </div>
  );
}
