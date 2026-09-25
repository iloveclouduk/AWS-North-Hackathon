import type { Resource, WorldSnapshot } from '../state/model.js';

/**
 * A small, deterministic Well-Architected check over what the city can see. The model never scores:
 * it only explains these results, so the same city always gets the same scorecard and nothing is
 * invented. Statuses follow the Agent Toolkit for AWS well-architected-review skill
 * (skills/core-skills/aws-well-architected-review, Apache-2.0): only report what was actually checked.
 */
export const PILLARS = ['operational-excellence', 'security', 'reliability', 'performance-efficiency', 'cost-optimization', 'sustainability'] as const;
export type Pillar = (typeof PILLARS)[number];
export type Status = 'meets' | 'partial' | 'gap' | 'not-applicable';

export interface Finding {
  pillar: Pillar;
  status: Exclude<Status, 'not-applicable'>;
  resourceId?: string;
  text: string;
  /** Verified docs.aws.amazon.com / aws.amazon.com page. */
  url: string;
}

export interface Scorecard {
  pillars: Record<Pillar, { status: Status; findings: Finding[] }>;
  findings: Finding[];
  /** 0–100 over the pillars that had anything to check. */
  score: number | null;
}

export const PILLAR_URL: Record<Pillar, string> = {
  'operational-excellence': 'https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/welcome.html',
  security: 'https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html',
  reliability: 'https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html',
  'performance-efficiency': 'https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html',
  'cost-optimization': 'https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html',
  sustainability: 'https://docs.aws.amazon.com/wellarchitected/latest/sustainability-pillar/sustainability-pillar.html',
};

const DOCS = {
  imds: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-new-instances.html',
  credits: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode.html',
  graviton: 'https://aws.amazon.com/ec2/graviton/',
  sgRules: 'https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html',
  lifecycle: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html',
  azs: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html',
  onDemand: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html',
  pitr: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html',
  s3Bpa: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html',
  s3Enc: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html',
  runtimes: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html',
};

/** Lambda runtimes past end of standard support (checked against the Lambda runtimes page, Sept 2026). */
const OLD_RUNTIME = /^(nodejs(1[0-8]|[4-9])\.|python(2\.|3\.[0-8]$)|ruby2\.|java8$|go1\.x|dotnetcore|dotnet[3-6]$)/;

const live = (r: Resource) => !['terminated', 'shutting-down', 'deleted'].includes(r.state);

export const reviewWorld = (s: WorldSnapshot): Scorecard => {
  const f: Finding[] = [];
  const add = (pillar: Pillar, status: Finding['status'], text: string, url: string, resourceId?: string) => f.push({ pillar, status, text, url, resourceId });
  const resources = s.resources.filter(live);
  const instances = resources.filter((r) => r.kind === 'instance');

  for (const i of instances) {
    const type = String(i.meta.instanceType ?? '');
    if (type.startsWith('t4g') || /^[a-z]\d+g/.test(type)) add('sustainability', 'meets', `${i.name} runs on Graviton (${type}): less energy per unit of work.`, DOCS.graviton, i.id);
    else if (type) add('performance-efficiency', 'partial', `${i.name} is ${type}; Graviton types often give better price-performance.`, DOCS.graviton, i.id);
    if (i.managedByGame) {
      add('security', 'meets', `${i.name} requires IMDSv2 (the city always launches with it).`, DOCS.imds, i.id);
      if (type.startsWith('t')) add('cost-optimization', 'meets', `${i.name} uses standard CPU credits, so no surprise surplus-credit charges.`, DOCS.credits, i.id);
    }
    if (i.meta.publicIp) add('security', 'partial', `${i.name} has a public IP. Keep only the ports you need open in its security group.`, DOCS.sgRules, i.id);
    if (i.state === 'running' && i.managedByGame) add('cost-optimization', 'partial', `${i.name} is running and billing by the second. Stop it when you're not using it.`, DOCS.lifecycle, i.id);
  }
  const running = instances.filter((i) => i.state === 'running');
  const zones = new Set(running.map((i) => i.meta.availabilityZone).filter(Boolean));
  if (running.length >= 2) {
    add('reliability', zones.size >= 2 ? 'meets' : 'gap', zones.size >= 2 ? `Your running instances are spread over ${zones.size} Availability Zones.` : 'All running instances are in one Availability Zone; one AZ problem would stop them all.', DOCS.azs);
  }

  for (const g of resources.filter((r) => r.kind === 'security-group')) {
    if (g.meta.openToWorld) add('security', 'gap', `Security group ${g.name} allows traffic from anywhere (0.0.0.0/0). Limit it to your IP or the load balancer.`, DOCS.sgRules, g.id);
  }

  for (const t of resources.filter((r) => r.kind === 'table')) {
    if (t.meta.billing === 'PAY_PER_REQUEST') add('cost-optimization', 'meets', `${t.name} is on-demand: you pay per request and ~nothing when idle.`, DOCS.onDemand, t.id);
    else if (t.meta.billing) add('cost-optimization', 'partial', `${t.name} uses provisioned capacity; make sure auto scaling matches your traffic.`, DOCS.onDemand, t.id);
    if (t.managedByGame) add('reliability', 'partial', `${t.name}: turn on point-in-time recovery for data you want to keep.`, DOCS.pitr, t.id);
  }

  const buckets = resources.filter((r) => r.kind === 'bucket' && r.managedByGame);
  for (const b of buckets) {
    add('security', 'meets', `${b.name} was created with Block Public Access on (the S3 default for new buckets).`, DOCS.s3Bpa, b.id);
    add('security', 'meets', `${b.name} encrypts new objects at rest by default (SSE-S3).`, DOCS.s3Enc, b.id);
  }

  for (const fn of resources.filter((r) => r.kind === 'function')) {
    const rt = String(fn.meta.runtime ?? '');
    if (rt && OLD_RUNTIME.test(rt)) add('operational-excellence', 'gap', `${fn.name} uses ${rt}, which no longer gets security updates. Move to a supported runtime.`, DOCS.runtimes, fn.id);
    else if (rt) add('operational-excellence', 'meets', `${fn.name} is on a supported runtime (${rt}).`, DOCS.runtimes, fn.id);
  }

  if (resources.some((r) => r.managedByGame)) add('operational-excellence', 'meets', 'Everything the city built is tagged managed-by=aws-city, so you can find and clean it up.', PILLAR_URL['operational-excellence']);

  const rank: Record<Finding['status'], number> = { meets: 2, partial: 1, gap: 0 };
  const pillars = Object.fromEntries(
    PILLARS.map((p) => {
      const mine = f.filter((x) => x.pillar === p);
      if (!mine.length) return [p, { status: 'not-applicable' as Status, findings: [] }];
      const worst = mine.reduce((a, b) => (rank[b.status] < rank[a.status] ? b : a)).status;
      return [p, { status: worst as Status, findings: mine }];
    }),
  ) as Scorecard['pillars'];
  const scored = PILLARS.filter((p) => pillars[p].status !== 'not-applicable');
  const score = scored.length
    ? Math.round((100 * scored.reduce((sum, p) => sum + pillars[p].findings.reduce((a, x) => a + rank[x.status], 0) / (2 * pillars[p].findings.length), 0)) / scored.length)
    : null;
  return { pillars, findings: f, score };
};

/** Compact text for the model (the agent turns it into one friendly bubble). */
export const scorecardText = (c: Scorecard) =>
  c.score === null
    ? 'Nothing built yet, so there is nothing to review. Suggest building something small first.'
    : [
        `Well-Architected score: ${c.score}/100 (only what the city could check).`,
        ...PILLARS.filter((p) => c.pillars[p].status !== 'not-applicable').map(
          (p) => `${p}: ${c.pillars[p].status} — ${c.pillars[p].findings.map((x) => `${x.status}: ${x.text} (${x.url})`).join(' | ')}`,
        ),
      ].join('\n');
