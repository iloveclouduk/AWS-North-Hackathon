// The Region sign: the real facts of the Region this city is (its AZs, opt-in, partition), what AWS doesn't offer
// here yet, a few list prices next to us-east-1's, and (when the player turned it on) what they spent here this month.
// Everything comes from shared/region-facts.json and shared/prices.json, with their sources.
import { useCity } from '@/state/store';
import {
  accountZones, availability, compare, monthlyNote, FACTS, nearestOffering, partitionName, perUnit, price, PRICES, regionFacts, regionInfo,
  separatePartition, signatureFor, statusText, zonesFor,
} from '@/world/regions';
import { bus } from '@/state/bus';
import { SERVICES } from '@/world/taxonomy';
import { BillLine } from './BillLine';
import { FlowLine } from './FlowLine';
import { Plain } from './Term';

const Src = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="src" href={href} target="_blank" rel="noreferrer">
    {children} ↗
  </a>
);

/** The few prices every Region sign shows (when the Region has them). */
const HEADLINE = ['ec2.t4g.micro', 's3.standard', 'lambda.requests', 'dt.internet', 'dt.interaz'];

export function RegionFactsCard() {
  const region = useCity((s) => s.cityRegion);
  const inventory = useCity((s) => s.inventory);
  const r = regionInfo(region);
  const f = regionFacts(region);
  const zones = zonesFor(region, accountZones(inventory, region));
  const fromAccount = !!accountZones(inventory, region)?.length;
  const missing = SERVICES.filter((s) => availability(s.id, region).status !== 'available');
  const prices = HEADLINE.flatMap((k) => price(k, region) ?? []);
  const here = inventory?.regions?.[region] ?? 0;

  return (
    <div className="card culture campus region-facts">
      <h3>🗺️ {r?.name ?? region}</h3>
      <p>
        <Plain
          text={`This city is one AWS Region, ${region}${f?.geography ? `, in ${f.geography}` : ''}. Its islands are Availability Zones: each one is a group of data centres with its own power and cooling. Put your app on two islands and it keeps running even if one goes dark.`}
        />
      </p>
      {signatureFor(region) && (
        <button className="btn tiny" onClick={() => bus.emit('flyTo', { id: 'signature' })}>
          🏙️ See {r?.city ?? region}'s landmark: {signatureFor(region)!.label}
        </button>
      )}
      <ul className="facts">
        <li>
          {f?.regionsTableAzCount !== undefined ? (
            <>
              <b>{f.regionsTableAzCount} Availability Zones for most accounts.</b>{' '}
              <span className="muted">
                AWS lists {f.azIds.length} AZ IDs here; some accounts can't use one of them (a constrained AZ).
              </span>
            </>
          ) : (
            <b>{f?.azIds.length ? `${f.azIds.length} Availability Zones` : 'Availability Zones'}</b>
          )}
          {f?.fewerForNewAccounts ? <span className="muted">. Newer accounts can use two of them.</span> : null}
        </li>
        {f?.comingAzs?.map((c) => (
          <li key={`${c.year}${c.geography}`}>
            Another AZ is coming in {c.year} ({c.geography}).
          </li>
        ))}
        {separatePartition(region) ? null : <li>{f?.optIn ? 'Opt-in Region: an account has to turn it on before using it.' : 'On by default in every account.'}</li>}
        {separatePartition(region) ? <li>{partitionName(region)}: a separate partition, so it needs its own account. A standard AWS account can't reach it.</li> : null}
        <li>
          Your resources here: <b>{here}</b>
        </li>
      </ul>
      <BillLine region={region} />
      <FlowLine />

      <h4>Availability Zones</h4>
      <ul className="azs">
        {zones.map((z) => (
          <li key={z.id}>
            <b>{z.id}</b>
            {z.name ? <span className="muted"> · your account calls it {z.name}</span> : null}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {f?.azIds.length
          ? `AZ IDs (like ${f.azIds[0]}) are the same place in every account.${fromAccount ? ' The names come from your account.' : ''}${
              f.independentNames
                ? ` This is one of nine older Regions where accounts created before November 2025 have their own AZ names, so ${region}a can be a different AZ in another account. Match by AZ ID.`
                : ''
            }`
          : "AWS's AZ table covers standard Regions only, so the city shows three, the minimum every Region has."}
      </p>

      {missing.length ? (
        <>
          <h4>Not offered here</h4>
          <ul className="missing">
            {missing.map((s) => {
              const near = nearestOffering(s.id, region, 1)[0];
              return (
                <li key={s.id}>
                  <b>{s.name}</b> <span className="muted">· {statusText(availability(s.id, region))}</span>
                  {near ? <span className="muted"> · nearest: {near.code}</span> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p>Every service in this city is offered here.</p>
      )}

      {prices.length ? (
        <>
          <h4>Prices here</h4>
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
          </ul>
          <p className="muted small">
            List prices in USD as of {PRICES.asOf}, before tax, Free Tier and Savings Plans.
          </p>
        </>
      ) : (
        <p className="muted small">{PRICES.skipped.find((s) => s.region === region)?.reason ?? 'No list prices for this Region yet.'}</p>
      )}

      <p className="muted">
        <Src href={FACTS.docs.azs}>Availability Zones</Src> · <Src href={FACTS.docs.regions}>Regions</Src> · <Src href={FACTS.docs.availability}>Services by Region</Src>
        {prices[0] ? (
          <>
            {' '}
            · <Src href={prices[0].source}>Pricing</Src>
          </>
        ) : null}
      </p>
    </div>
  );
}
