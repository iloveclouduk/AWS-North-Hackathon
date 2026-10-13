// Builds shared/region-facts.json: for every Region in shared/regions.json, its real Availability Zones (AZ IDs), opt-in
// status, partition and geography, and which of our services AWS offers there (or plans to). Every fact comes from the
// public AWS Knowledge MCP server (no credentials): the docs pages below and its regional-availability tool.
//
// Usage: npm run region-facts
// Dev-time only. The game's agents never get these tools (server/src/knowledge/mcp.ts ALLOWED_TOOLS).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shared', 'region-facts.json');
const MCP = 'https://knowledge-mcp.global.api.aws';
const AZ_PAGE = 'https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html';
const REGIONS_PAGE = 'https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html';
const AVAILABILITY = 'https://aws.amazon.com/about-aws/global-infrastructure/regional-product-services/';

/**
 * Our service id → the product names the availability tool uses. The first is the landmark's main product; the
 * others are shown as extra lines (a combined landmark like "SQS & SNS").
 */
export const PRODUCTS = {
  ec2: ['Amazon Elastic Compute Cloud (EC2)'],
  lambda: ['AWS Lambda'],
  ecs: ['Amazon Elastic Container Service (ECS)'],
  fargate: ['AWS Fargate'],
  eks: ['Amazon Elastic Kubernetes Service (EKS)'],
  beanstalk: ['AWS Elastic Beanstalk'],
  s3: ['Amazon Simple Storage Service (S3)'],
  ebs: ['Amazon Elastic Block Store (EBS)'],
  efs: ['Amazon Elastic File System (EFS)'],
  glue: ['AWS Glue'],
  athena: ['Amazon Athena'],
  lakeformation: ['AWS Lake Formation'],
  dynamodb: ['Amazon DynamoDB'],
  rds: ['Amazon Relational Database Service (RDS)'],
  aurora: ['Amazon Aurora', 'Amazon Aurora DSQL'],
  elasticache: ['Amazon ElastiCache'],
  redshift: ['Amazon Redshift'],
  neptune: ['Amazon Neptune'],
  vpc: ['Amazon Virtual Private Cloud (VPC)'],
  route53: ['Amazon Route 53'],
  cloudfront: ['Amazon CloudFront'],
  apigateway: ['Amazon API Gateway'],
  sqs: ['Amazon Simple Queue Service (SQS)', 'Amazon Simple Notification Service (SNS)'],
  eventbridge: ['Amazon EventBridge'],
  iam: ['AWS Identity and Access Management (IAM)'],
  cognito: ['Amazon Cognito'],
  kms: ['AWS Key Management Service (KMS)'],
  shield: ['AWS Shield', 'AWS WAF'],
  guardduty: ['Amazon GuardDuty'],
  cloudwatch: ['Amazon CloudWatch', 'AWS CloudTrail'],
  bedrock: ['Amazon Bedrock'],
  agentcore: ['Amazon Bedrock AgentCore'],
  sagemaker: ['Amazon SageMaker AI'],
  q: ['Amazon Q Developer', 'Amazon Q Business'],
  rekognition: ['Amazon Rekognition'],
  textract: ['Amazon Textract'],
};
/** Global services: one control plane for the whole partition, so every city has them. */
export const GLOBAL = ['iam', 'route53', 'cloudfront'];
const RANK = ['isAvailableIn', 'isPlannedIn', 'isBeingPlannedIn', 'isNotExpandingIn'];
/**
 * Where the regional-availability tool lags or answers a different question, the service's own docs page wins.
 * Each override names its page; the Regions are read from it (bulleted names or codes), not typed in here.
 */
const OVERRIDES = [
  // The tool lists where Q Developer is *hosted* (us-east-1, eu-central-1); its Regions page lists where you can use it.
  { service: 'q', product: 'Amazon Q Developer', page: 'https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/regions.html', by: 'names', optInNote: 'Free tier only in opt-in Regions' },
  // Neptune's own Regions list is newer than the tool's rows for some Regions.
  { service: 'neptune', product: 'Amazon Neptune', page: 'https://docs.aws.amazon.com/neptune/latest/userguide/limits.html', by: 'codes' },
];
/** CloudFront isn't in GovCloud: you use it from a standard account with GovCloud as the origin. */
const GOVCLOUD_CLOUDFRONT = 'https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/setting-up-cloudfront.html';
const AZ_IDS_PAGE = 'https://docs.aws.amazon.com/global-infrastructure/latest/regions/az-ids.html';
const STATUS = { isAvailableIn: 'available', isPlannedIn: 'planned', isBeingPlannedIn: 'considering', isNotExpandingIn: 'not-planned' };

// ── A minimal MCP client over Streamable HTTP (JSON-RPC; replies may be plain JSON or one SSE event) ──
let session;
let nextId = 1;
const rpc = async (method, params, notify = false) => {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(notify ? {} : { id: nextId++ }) }),
  });
  session = res.headers.get('mcp-session-id') ?? session;
  if (notify) return undefined;
  const text = await res.text();
  const json = text.trimStart().startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).at(-1);
  const msg = JSON.parse(json ?? '{}');
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return msg.result;
};
const call = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  return r.content.map((c) => c.text ?? '').join('');
};
const readDoc = async (url) => {
  let out = '';
  for (let start = 0; ; ) {
    const page = JSON.parse(await call('aws___read_documentation', { requests: [{ url, max_length: 20000, start_index: start }] })).content.result[0];
    if (page.status !== 'SUCCESS') throw new Error(`${url}: ${page.status} ${page.error_code ?? ''}`);
    out += page.content;
    if (!page.truncated) return out;
    start = page.end_index;
  }
};

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'aws-city-region-facts', version: '1' } });
await rpc('notifications/initialized', {}, true);

const regions = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'regions.json'), 'utf8'));
const asOf = new Date().toISOString().slice(0, 10);

// ── AZ IDs: the docs table rows "| `use1-az1` | `us-east-1` | Virginia, ... |" and "| *Coming in 2026* | `us-east-1` | Maryland ... |" ──
const azPage = await readDoc(AZ_PAGE);
const azIds = {};
const coming = {};
for (const m of azPage.matchAll(/\|\s*`([a-z0-9]+-az\d+)`\s*\|\s*`([a-z0-9-]+)`[^|]*\|\s*([^|]+?)\s*\|/g)) (azIds[m[2]] ??= []).push({ id: m[1], geography: m[3] });
for (const m of azPage.matchAll(/\|\s*\*Coming in (\d{4})\*\s*\|\s*`([a-z0-9-]+)`[^|]*\|\s*([^|]+?)\s*\|/g)) (coming[m[2]] ??= []).push({ year: Number(m[1]), geography: m[3] });

// ── The Regions table: "| us-east-1 | US East (N. Virginia) | 6 | United States of America | Not required |" ──
const regionsPage = await readDoc(REGIONS_PAGE);
const table = {};
for (const m of regionsPage.matchAll(/^\|\s*([a-z]{2}(?:-[a-z]+)+-\d)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*(†?)\s*\|\s*([^|]+?)\s*\|\s*(Required|Not required)\s*\|/gm)) {
  table[m[1]] = { azCount: Number(m[3]), fewerForNewAccounts: m[4] === '†', geography: m[5], optIn: m[6] === 'Required' };
}

const partitionOf = (code) => (code.startsWith('us-gov-') ? 'aws-us-gov' : code.startsWith('eusc-') ? 'aws-eusc' : 'aws');

// ── Service availability: 10 Regions per call (the tool's limit), a few products at a time (it caps the filter list) ──
const FILTERS_PER_CALL = 8;
const productNames = [...new Set(Object.values(PRODUCTS).flat())];
const availability = {};
const codes = regions.regions.map((r) => r.code);
for (let i = 0; i < codes.length; i += 10) {
  const batch = codes.slice(i, i + 10);
  for (let k = 0; k < productNames.length; k += FILTERS_PER_CALL) {
    const raw = await call('aws___get_regional_availability', { regions: batch, resource_type: 'product', filters: productNames.slice(k, k + FILTERS_PER_CALL) });
    const j = JSON.parse(raw);
    if (!j.content) throw new Error(`availability: ${raw.slice(0, 300)}`);
    const res = j.content.result;
    if (res.failed_regions?.length) console.warn('availability failed for', res.failed_regions);
    for (const [product, byRegion] of Object.entries(res.products ?? {})) {
      for (const [code, v] of Object.entries(byRegion)) ((availability[code] ??= {})[product] = v);
    }
  }
}

const byName = new Map(regions.regions.map((r) => [r.name, r.code]));
const listed = (text, by) =>
  by === 'codes'
    ? new Set(text.match(/\b[a-z]{2}(?:-[a-z]+)+-\d\b/g) ?? [])
    : new Set([...text.matchAll(/^\s*\*\s+(.+?)\s*$/gm)].map((m) => byName.get(m[1])).filter(Boolean));
const overridden = {};
for (const o of OVERRIDES) {
  const yes = listed(await readDoc(o.page), o.by);
  for (const code of yes) {
    if (!availability[code]?.[o.product]) continue;
    if (availability[code][o.product].status !== 'isAvailableIn') (overridden[code] ??= []).push(o.service);
    availability[code][o.product] = { status: 'isAvailableIn' };
  }
  o.regions = yes;
}
// "In the following Regions, for accounts created before November 2025, we independently map…": the bullets that follow.
const azIdsText = await readDoc(AZ_IDS_PAGE);
const mapped = azIdsText.slice(azIdsText.indexOf('we independently map'));
const independentNames = listed(mapped.slice(0, mapped.indexOf('##')), 'names');
if (independentNames.size < 5) throw new Error(`az-ids.html: expected the independently mapped Regions, found ${[...independentNames]}`);

const out = {
  source: `${MCP} (AWS Knowledge MCP Server: ${AZ_PAGE}, ${REGIONS_PAGE}, tool aws___get_regional_availability)`,
  docs: { azs: AZ_PAGE, overrides: OVERRIDES.map((o) => o.page).join(' '), regions: REGIONS_PAGE, availability: AVAILABILITY, azIds: 'https://docs.aws.amazon.com/global-infrastructure/latest/regions/az-ids.html' },
  asOf,
  note:
    'AZ IDs are the same physical place in every account; AZ names (us-east-1a) may map to different AZ IDs per account in the oldest Regions. ' +
    'Regions outside the commercial partition (GovCloud, European Sovereign Cloud) have no published AZ ID table: azIds is empty and the city draws the documented minimum of three. ' +
    'Service status: available, planned (with a launch quarter), considering, not-planned, or outside-partition. Where a service\'s own Regions page disagrees with the tool, the page wins (docs.overrides).',
  global: GLOBAL,
  products: PRODUCTS,
  regions: {},
};
let missing = 0;
for (const code of codes) {
  const t = table[code];
  const ids = azIds[code] ?? [];
  const disagree = partitionOf(code) === 'aws' && (!t || t.azCount !== ids.length);
  if (disagree) console.warn(`${code}: Regions table says ${t?.azCount} AZs, AZ table lists ${ids.length}`);
  const services = {};
  for (const [id, names] of Object.entries(PRODUCTS)) {
    const rows = names.map((n) => availability[code]?.[n]);
    if (!rows[0]) {
      missing++;
      console.warn(`${code}: no availability row for ${names[0]}`);
      continue;
    }
    // A combined landmark (Amazon Q, SQS & SNS…) is open when any of its products is; the others are listed too.
    const best = rows.filter(Boolean).sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))[0];
    const s = { status: STATUS[best.status] ?? best.status, ...(best.launch_date ? { launch: best.launch_date } : {}) };
    const extra = names.flatMap((n, i) => (rows[i] && names.length > 1 ? [{ product: n, status: STATUS[rows[i].status] ?? rows[i].status, ...(rows[i].launch_date ? { launch: rows[i].launch_date } : {}) }] : []));
    if (id === 'cloudfront' && partitionOf(code) === 'aws-us-gov') {
      services[id] = { status: 'outside-partition', source: GOVCLOUD_CLOUDFRONT };
      continue;
    }
    const o = OVERRIDES.find((x) => x.service === id && x.regions?.has(code));
    const note = o?.optInNote && table[code]?.optIn ? { note: o.optInNote } : {};
    services[id] = { ...s, ...note, ...(extra.length ? { extra } : {}), ...(overridden[code]?.includes(id) ? { source: o.page } : {}) };
  }
  out.regions[code] = {
    partition: partitionOf(code),
    // Opt-in is a standard-account idea; GovCloud and the Sovereign Cloud need their own account instead.
    optIn: t?.optIn ?? false,
    ...(t?.geography ? { geography: t.geography } : {}),
    azIds: ids.map((a) => a.id),
    ...(disagree && t ? { regionsTableAzCount: t.azCount } : {}),
    ...(t?.fewerForNewAccounts ? { fewerForNewAccounts: true } : {}),
    ...(independentNames.has(code) ? { independentNames: true } : {}),
    ...(coming[code] ? { comingAzs: coming[code] } : {}),
    services,
  };
}
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${codes.length} Regions, ${missing} missing availability rows`);
