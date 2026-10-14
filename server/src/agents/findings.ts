import { createHash } from 'node:crypto';
import waRules from '../../../shared/wa-rules.json' with { type: 'json' };
import { citizenFor } from '../citizens/roles.js';
import type { Resource, WorldSnapshot } from '../state/model.js';
import { serviceById, type CityFinding, type FindingFix, type PillarKey } from '../world.js';
import { deprecatedRuntime } from './wellarchitected.js';

/** What players read for each rule (shared/wa-rules.json); the checks below are the code half. */
export interface RuleText {
  id: string;
  pillar: PillarKey;
  severity: CityFinding['severity'];
  serviceId: string;
  title: string;
  text: string;
  why?: string;
  url: string;
  fix?: { fixId: string; title: string; preview: string; rollback: string; costNote?: string };
}
export const RULES = waRules.rules as RuleText[];
export const ruleById = (id: string) => RULES.find((r) => r.id === id);

/** One rule hit: the resource it's about (account-wide rules use a synthetic resource). */
interface Hit {
  ruleId: string;
  resource: { id: string; name: string; arn?: string; gameOwned: boolean };
  /** Account-wide setting: a fix always counts as outside the city's own resources. */
  accountWide?: boolean;
}

const live = (r: Resource) => !['terminated', 'shutting-down', 'deleted', 'deleting'].includes(r.state.toLowerCase());
const res = (r: Resource) => ({ id: r.id, name: r.name, gameOwned: r.managedByGame, ...(typeof r.meta.arn === 'string' ? { arn: r.meta.arn } : {}) });

/**
 * Deterministic checks over what the poller read. A setting that couldn't be read (null/undefined) never raises a
 * finding: the citizens only report what they actually checked.
 */
export const checkWorld = (s: WorldSnapshot): Hit[] => {
  const hits: Hit[] = [];
  const resources = s.resources.filter(live);
  const of = (kind: Resource['kind']) => resources.filter((r) => r.kind === kind);

  // S3 applies the most restrictive mix, setting by setting: a bucket is exposed only when some setting is off at both levels.
  const account = s.account?.s3AccountBpa;
  if (account) {
    for (const b of of('bucket')) {
      const bucket = typeof b.meta.bpa === 'string' ? b.meta.bpa : undefined;
      if (bucket && [...bucket].some((on, i) => on === '0' && account[i] === '0')) hits.push({ ruleId: 's3-public-access', resource: res(b) });
    }
  }
  for (const g of of('security-group')) if (g.meta.adminOpenToWorld === true) hits.push({ ruleId: 'sg-world-admin', resource: res(g) });
  for (const i of of('instance')) if (i.meta.httpTokens === 'optional' && i.meta.httpEndpoint !== 'disabled') hits.push({ ruleId: 'ec2-imdsv1', resource: res(i) });
  if (s.account?.ebsEncryptionByDefault === false) {
    hits.push({ ruleId: 'ebs-default-encryption', resource: { id: `ebs-default:${s.region}`, name: `EBS encryption by default (${s.region})`, gameOwned: false }, accountWide: true });
  }
  for (const t of of('table')) if (t.meta.pitr === false) hits.push({ ruleId: 'dynamodb-no-pitr', resource: res(t) });
  for (const f of of('function')) if (deprecatedRuntime(String(f.meta.runtime ?? ''))) hits.push({ ruleId: 'lambda-old-runtime', resource: res(f) });
  for (const d of of('db-instance')) {
    if (d.meta.public === true) hits.push({ ruleId: 'rds-public', resource: res(d) });
    if (d.meta.multiAz === false) hits.push({ ruleId: 'rds-single-az', resource: res(d) });
  }
  if (s.account?.trails === 0) hits.push({ ruleId: 'no-cloudtrail', resource: { id: `trails:${s.region}`, name: 'CloudTrail', gameOwned: false }, accountWide: true });
  for (const v of s.account?.unattachedVolumes ?? []) hits.push({ ruleId: 'ebs-unattached', resource: { id: v.id, name: v.name, gameOwned: false } });
  for (const i of of('instance')) {
    const type = String(i.meta.instanceType ?? '');
    if (previousGeneration(type)) hits.push({ ruleId: 'ec2-previous-generation', resource: res(i) });
    else if (gravitonCandidate(type)) hits.push({ ruleId: 'ec2-graviton-candidate', resource: res(i) });
  }
  const running = of('instance').filter((i) => i.state === 'running');
  if (running.length >= 2 && new Set(running.map((i) => i.meta.availabilityZone).filter(Boolean)).size === 1) {
    hits.push({ ruleId: 'ec2-one-az', resource: { id: `azs:${s.region}`, name: 'Your running instances', gameOwned: false }, accountWide: true });
  }
  return hits;
};

const family = (type: string) => type.split('.')[0] ?? '';
/**
 * Previous-generation instance families (EC2 instance-types.html#previous-gen-instances, checked 2026-10-10; X1/X1e are current).
 * Kept as data here; the accuracy loop re-checks it against the docs.
 */
export const PREVIOUS_GENERATION = new Set(['a1', 'c1', 'c3', 'c4', 'g2', 'g3', 'g3s', 'i2', 'm1', 'm2', 'm3', 'm4', 'p2', 'p3', 'p3dn', 'r3', 'r4', 't1']);
export const previousGeneration = (type: string) => PREVIOUS_GENERATION.has(family(type));
/** x86 families with a direct Graviton (Arm) counterpart: t → t4g; m/c/r → m/c/r 6g–8g. */
const GRAVITON_PAIRED = /^(t3a?|[mcr](5|5a|5d|5n|5ad|6i|6a|6id|7i|7a))$/;
export const gravitonCandidate = (type: string) => GRAVITON_PAIRED.test(family(type));

/** Same rule on the same resource → same id, so a finding keeps its id across polls. */
export const findingId = (ruleId: string, resourceId: string) => `f-${createHash('sha256').update(`${ruleId}\0${resourceId}`).digest('hex').slice(0, 16)}`;

const fill = (text: string, name: string) => text.replaceAll('{name}', name);

export const toFinding = (hit: Hit, status: CityFinding['status'] = 'open'): CityFinding | undefined => {
  const rule = ruleById(hit.ruleId);
  const service = rule && serviceById(rule.serviceId);
  if (!rule || !service) return undefined;
  const fix: FindingFix | undefined = rule.fix && {
    fixId: rule.fix.fixId,
    title: rule.fix.title,
    preview: fill(rule.fix.preview, hit.resource.name),
    rollback: rule.fix.rollback,
    ...(rule.fix.costNote ? { costNote: rule.fix.costNote } : {}),
    scope: hit.resource.gameOwned && !hit.accountWide ? 'game' : 'account',
  };
  return {
    id: findingId(rule.id, hit.resource.id),
    ruleId: rule.id,
    serviceId: rule.serviceId,
    districtId: service.districtId,
    citizenId: citizenFor(rule.pillar).id,
    pillar: rule.pillar,
    severity: rule.severity,
    status,
    resource: hit.resource,
    title: rule.title,
    text: fill(rule.text, hit.resource.name),
    ...(rule.why ? { why: fill(rule.why, hit.resource.name) } : {}),
    url: rule.url,
    ...(fix ? { fix } : {}),
  };
};

export const findingsFor = (s: WorldSnapshot): CityFinding[] => checkWorld(s).flatMap((h) => toFinding(h) ?? []);

/** New and resolved findings between two checks (both keyed by id). */
export const diffFindings = (prev: Map<string, CityFinding>, next: CityFinding[]): CityFinding[] => {
  const now = new Map(next.map((f) => [f.id, f]));
  const opened = next.filter((f) => !prev.has(f.id));
  const resolved = [...prev.values()].filter((f) => !now.has(f.id)).map((f) => ({ ...f, status: 'resolved' as const }));
  return [...opened, ...resolved];
};
