// Live traffic (contract v2.8 city.flow), opt-in: CloudWatch charges the account per metric it analyzes, so it's read
// only after the player turns it on, then at most every 5 minutes while the city is open (about a cent a day).
import { setFlow } from '@/app/runtime';
import { useCity } from '@/state/store';

/** The switch, and what the city is showing: real requests, as request cars driving in from the highway. */
export function FlowLine() {
  const on = useCity((s) => s.flowOn);
  const flow = useCity((s) => s.flow);
  const linked = useCity((s) => s.account.linked);
  if (!linked) return null;
  if (!on)
    return (
      <div className="bill-line muted small">
        <button className="btn ghost tiny" onClick={() => setFlow(true)}>
          🚗 Show live traffic
        </button>{' '}
        Request cars follow your real request counts from CloudWatch, read every few minutes while the city is open
        (CloudWatch charges about a cent a day).
      </div>
    );
  if (!flow) return <div className="bill-line muted small">🚗 Reading your traffic…</div>;
  if (flow.unavailable !== undefined) return <div className="bill-line muted small">🚗 {flow.unavailable}</div>;
  const total = flow.rates.reduce((a, r) => a + r.perMin, 0);
  return (
    <div className="bill-line small">
      🚗 Live traffic: <b>{flow.rates.length ? `about ${total.toLocaleString()} a minute` : 'quiet right now'}</b>{' '}
      <span className="muted">
        {flow.rates.map((r) => `${r.label} ${r.perMin.toLocaleString()}`).join(' · ')} (last {flow.windowMin} min).{' '}
        <button className="btn ghost tiny" onClick={() => setFlow(false)}>
          Hide
        </button>
      </span>
    </div>
  );
}
