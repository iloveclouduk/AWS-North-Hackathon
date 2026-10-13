// The demo city's pretend AWS account (shared/demo-account.json): what MockBackend sends as city.inventory and
// city.finding, built from the same rule text the server uses (shared/wa-rules.json).
import demoJson from '../../shared/demo-account.json' with { type: 'json' };
import demoHealthJson from '../../shared/demo-health.json' with { type: 'json' };
import type { AwsHealthEvent, AwsIncident, AwsNewsEvent, AzInfo, CityBillReadyEvent, CityFinding, CityFlowReadyEvent, CityInventoryEvent, DataLink, InventoryItem } from './contract';
import { citizenForPillar, ruleById } from '@/world/citizens';
import { serviceById } from '@/world/taxonomy';

interface DemoFinding {
  ruleId: string;
  /** An item's ARN, or "region" for an account-wide setting. */
  resource: string;
  /** Name shown for an account-wide setting. */
  name?: string;
  /** The citizen's scripted answer to Explain: what happens if you ignore it, and what to do. */
  explain?: string;
}
interface DemoAccount {
  accountId: string;
  region: string;
  items: InventoryItem[];
  findings: DemoFinding[];
  /** Data moving between Regions and AZs. */
  links?: DataLink[];
  /** v2.5: the account's AZ names → AZ IDs (names are mapped per account, so not in id order). */
  zones?: Record<string, AzInfo[]>;
  regionStatus?: CityInventoryEvent['regionStatus'];
  /** v2.5: a small learner's month-to-date bill (the month and time are filled in when it's sent). */
  bill?: Pick<CityBillReadyEvent, 'currency' | 'total' | 'byService' | 'byRegion'>;
}

export const DEMO = demoJson as unknown as DemoAccount;

/** Items with service ids checked against shared/world.json (an unknown id is an unmapped type). */
export const demoItems = (): InventoryItem[] =>
  DEMO.items.map((it) => {
    const known = it.serviceId && serviceById(it.serviceId);
    return { ...it, serviceId: known ? it.serviceId : null, districtId: known ? serviceById(it.serviceId!)!.districtId : it.districtId };
  });

/**
 * The demo account's inventory. `crossRegion: false` (before the player links the practice account) leaves out its
 * links to other Regions (the global table and S3 replication): the world map draws no arcs and no tankers drive out
 * for anything the player hasn't connected yet. Links inside the Region (Multi-AZ standby, load balancer) always show.
 */
export function demoInventory(now = new Date(), { crossRegion = true }: { crossRegion?: boolean } = {}): CityInventoryEvent {
  const items = demoItems();
  const counts: Record<string, number> = {};
  const regions: Record<string, number> = {};
  for (const it of items) {
    const r = it.region ?? DEMO.region;
    regions[r] = (regions[r] ?? 0) + 1;
    // Like the server: the home city counts its own Region (and global resources); other Regions are their own cities.
    if (r !== DEMO.region && r !== 'global') continue;
    const k = it.serviceId ?? 'other';
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return {
    type: 'city.inventory',
    takenAt: now.toISOString(),
    region: DEMO.region,
    source: 'mock',
    complete: true,
    counts,
    items,
    truncated: false,
    homeRegion: DEMO.region,
    regions,
    links: (DEMO.links ?? []).filter((l) => crossRegion || l.from.region === l.to.region),
    ...(DEMO.zones ? { zones: DEMO.zones } : {}),
    ...(DEMO.regionStatus ? { regionStatus: DEMO.regionStatus } : {}),
  };
}

/** The demo bill for this month (MockBackend sends it once the player turns the bill on). */
export function demoBill(now = new Date()): CityBillReadyEvent {
  const b = DEMO.bill ?? { currency: 'USD', total: 0, byService: {}, byRegion: {} };
  return { type: 'city.bill', month: now.toISOString().slice(0, 7), currency: b.currency, total: b.total, byService: { ...b.byService }, byRegion: { ...b.byRegion }, takenAt: now.toISOString(), estimated: true };
}

const fill = (text: string, name: string) => text.replaceAll('{name}', name);

/** The planted findings, all open, built from wa-rules.json. */
export function demoFindings(): CityFinding[] {
  const items = demoItems();
  const out: CityFinding[] = [];
  for (const d of DEMO.findings) {
    const rule = ruleById(d.ruleId);
    const svc = rule && serviceById(rule.serviceId);
    const citizen = rule && citizenForPillar(rule.pillar);
    if (!rule || !svc || !citizen) continue;
    const accountWide = d.resource === 'region';
    const item = accountWide ? undefined : items.find((i) => i.arn === d.resource);
    if (!accountWide && !item) continue;
    const name = item?.name ?? d.name ?? `${rule.id}-${DEMO.region}`;
    const resource = item
      ? { id: item.arn.split(/[:/]/).at(-1)!, name, arn: item.arn, gameOwned: item.managedByGame }
      : { id: `${DEMO.region}:${rule.id}`, name, gameOwned: false };
    const f: CityFinding = {
      id: `${rule.id}:${resource.id}`,
      ruleId: rule.id,
      serviceId: svc.id,
      districtId: svc.districtId,
      citizenId: citizen.id,
      pillar: rule.pillar,
      severity: rule.severity,
      status: 'open',
      resource,
      title: rule.title,
      text: fill(rule.text, name),
      ...(rule.why ? { why: fill(rule.why, name) } : {}),
      url: rule.url,
    };
    if (rule.fix) {
      f.fix = {
        fixId: rule.fix.fixId,
        title: rule.fix.title,
        preview: fill(rule.fix.preview, name),
        rollback: fill(rule.fix.rollback, name),
        scope: resource.gameOwned ? 'game' : 'account',
        ...(rule.fix.costNote ? { costNote: rule.fix.costNote } : {}),
      };
    }
    out.push(f);
  }
  return out;
}

/**
 * v2.8: the demo account's live traffic: a small web app behind a load balancer in two AZs, its Lambda functions, API
 * and table. It moves a little from minute to minute (±15 %, the same for everyone in the same minute).
 */
export function demoFlow(now = new Date()): CityFlowReadyEvent {
  const minute = Math.floor(now.getTime() / 60_000);
  const wobble = (k: number) => {
    const x = Math.sin(minute * 12.9898 + k * 78.233) * 43758.5453;
    return 0.85 + 0.3 * (x - Math.floor(x));
  };
  const n = (base: number, k: number) => Math.max(1, Math.round(base * wobble(k)));
  const a = n(140, 1);
  const c = n(90, 2);
  return {
    type: 'city.flow',
    region: 'us-west-2',
    windowMin: 15,
    takenAt: now.toISOString(),
    rates: [
      { id: 'alb', serviceId: 'ec2', kind: 'requests', label: 'Load balancer requests', perMin: a + c, byAz: { 'us-west-2a': a, 'us-west-2c': c } },
      { id: 'lambda', serviceId: 'lambda', kind: 'invocations', label: 'Lambda invocations', perMin: n(35, 3) },
      { id: 'apigateway', serviceId: 'apigateway', kind: 'requests', label: 'API requests', perMin: n(28, 4) },
      { id: 'dynamodb', serviceId: 'dynamodb', kind: 'writes', label: 'DynamoDB writes', perMin: n(20, 5) },
    ],
  };
}

/** The scripted Explain answer for a planted finding. */
export const demoExplain = (f: CityFinding) => DEMO.findings.find((d) => d.ruleId === f.ruleId)?.explain;

/** The resource type a finding changes (for the deploy preview's change row). */
export const demoResourceType = (f: CityFinding) => DEMO.items.find((i) => i.arn === f.resource.arn)?.type ?? 'AWS::Account::Setting';

// ── v2.6: AWS's public status in the demo (shared/demo-health.json) ──

const HEALTH = demoHealthJson as unknown as {
  incidents: AwsIncident[];
  drill: Omit<AwsIncident, 'started' | 'updated' | 'log'> & { log: { text: string }[] };
  news: AwsNewsEvent['items'];
};

/**
 * The dashboard as it stood when the demo was made (Bahrain, UAE), plus, once `drillAt` is set, a practice drill in the
 * demo's Region (always `drill: true`), resolved once `resolvedAt` is set.
 */
export function demoHealth(now = new Date(), drill?: { at: Date; resolvedAt?: Date }): AwsHealthEvent {
  const incidents = [...HEALTH.incidents];
  if (drill) {
    const d = HEALTH.drill;
    const resolved = drill.resolvedAt;
    incidents.unshift({
      ...d,
      status: resolved ? 'resolved' : 'open',
      started: drill.at.toISOString(),
      updated: (resolved ?? drill.at).toISOString(),
      log: (resolved ? [d.log[1], d.log[0]] : [d.log[0]]).map((l, i) => ({ text: l.text, at: (i === 0 ? (resolved ?? drill.at) : drill.at).toISOString() })),
      drill: true,
    });
  }
  return { type: 'aws.health', asOf: now.toISOString(), incidents };
}

export const demoNews = (now = new Date()): AwsNewsEvent => ({ type: 'aws.news', asOf: now.toISOString(), items: HEALTH.news });
