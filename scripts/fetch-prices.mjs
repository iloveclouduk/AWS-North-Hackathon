// Fetches real AWS list prices (USD, On-Demand, first usage tier) for every commercial Region in shared/regions.json
// and writes shared/prices.json, which the city shows on landmark cards, AZ bridges and the Region gate.
//
// Sources (both official AWS):
//  - the AWS Price List Bulk API (https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html),
//    one per-Region offer file per service (Lambda, S3, DynamoDB, RDS, AWSDataTransfer);
//  - the metered-unit maps the official pricing pages load (EC2 On-Demand, EBS, NAT gateway), because the EC2 bulk offer is ~440 MB
//    per Region. Their rateCode's first part is the Price List SKU.
//
// Usage: npm run prices        (--fresh ignores the cached downloads in .cache/prices/)
// No dependencies: global fetch (gzip is decoded for us) and node:fs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'prices');
const OUT = path.join(ROOT, 'shared', 'prices.json');
const FRESH = process.argv.includes('--fresh');
const DAY = 24 * 3600 * 1000;

const BULK = 'https://pricing.us-east-1.amazonaws.com';
const UNIT_MAPS = 'https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps';

const PAGE = {
  ec2: 'https://aws.amazon.com/ec2/pricing/on-demand/',
  ebs: 'https://aws.amazon.com/ebs/pricing/',
  lambda: 'https://aws.amazon.com/lambda/pricing/',
  s3: 'https://aws.amazon.com/s3/pricing/',
  dynamodb: 'https://aws.amazon.com/dynamodb/pricing/on-demand/',
  rds: 'https://aws.amazon.com/rds/mysql/pricing/',
  vpc: 'https://aws.amazon.com/vpc/pricing/',
  dt: 'https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer',
};

/** Not in the public commercial Price List: separate partitions. */
const OTHER_PARTITIONS = [
  [/^us-gov-/, 'AWS GovCloud (US) is the aws-us-gov partition, not in the public commercial Price List'],
  [/^eusc-/, 'The AWS European Sovereign Cloud is the aws-eusc partition, not in the public commercial Price List'],
  [/^cn-/, 'China Regions are the aws-cn partition, priced in CNY'],
];

const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`  warn: ${msg}`);
};

// ---------------------------------------------------------------------------------------------------- downloads

/** GET a JSON document, cached at .cache/prices/<name>. `immutable` files (versioned URLs) never expire. */
async function getJson(url, name, { immutable = false } = {}) {
  const file = path.join(CACHE, name);
  if (!FRESH && fs.existsSync(file) && (immutable || Date.now() - fs.statSync(file).mtimeMs < DAY)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'Accept-Encoding': 'gzip', 'User-Agent': 'aws-city-fetch-prices' } });
      if (res.status === 404 || res.status === 403) return null; // not published for this Region
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const json = JSON.parse(text);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return json;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** Run `fn` over items with bounded concurrency. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

const regionIndexes = {};
async function regionIndex(offer) {
  regionIndexes[offer] ??= getJson(`${BULK}/offers/v1.0/aws/${offer}/current/region_index.json`, `${offer}/region_index.json`);
  return regionIndexes[offer];
}

/** The per-Region bulk offer file, or null when the service isn't offered there. */
async function offerFile(offer, region) {
  const idx = await regionIndex(offer);
  const r = idx?.regions?.[region];
  if (!r) return null;
  // The version URL contains the publication timestamp, so a cached copy of it never goes stale.
  const version = r.currentVersionUrl.split('/').at(-3);
  return getJson(`${BULK}${r.currentVersionUrl}`, `${offer}/${version}/${region}.json`, { immutable: true });
}

// ---------------------------------------------------------------------------------------------------- price list helpers

/** Products matching `pred(attributes, product)` in a bulk offer file. */
function products(file, pred) {
  return Object.entries(file.products).filter(([, p]) => pred({ productFamily: p.productFamily, ...p.attributes }, p)).map(([sku, p]) => ({ sku, ...p }));
}

/** OnDemand price dimensions of a SKU, sorted by beginRange. */
function dimensions(file, sku) {
  const terms = file.terms?.OnDemand?.[sku];
  if (!terms) return [];
  return Object.values(terms)
    .flatMap((t) => Object.values(t.priceDimensions))
    .map((d) => ({ ...d, usd: Number(d.pricePerUnit?.USD), begin: Number(d.beginRange ?? 0) }))
    .filter((d) => Number.isFinite(d.usd))
    .sort((a, b) => a.begin - b.begin);
}

/** First usage tier; with `paid`, the first tier that costs something (skips a modelled free tier). */
function firstTier(dims, { paid = false } = {}) {
  return paid ? dims.find((d) => d.usd > 0) : dims[0];
}

/** Exactly one product, else a warning and null. */
function one(list, what) {
  if (list.length === 1) return list[0];
  if (list.length === 0) return null;
  // Same price on every match is harmless (duplicated SKUs); pick the first deterministically.
  warn(`${what}: ${list.length} matching products (${list.map((p) => p.sku).join(', ')}); using the first`);
  return list.sort((a, b) => a.sku.localeCompare(b.sku))[0];
}

/** usagetype with or without the Region prefix (`EUW1-Requests-Tier1`). */
const usage = (a, name) => new RegExp(`^([A-Z0-9]+-)?${name}$`).test(a.usagetype ?? '');

// ---------------------------------------------------------------------------------------------------- extractors

/** Each returns entries for one Region given its bulk files and page data. Missing → warning, no entry. */
function bulkEntry(region, file, { key, serviceId, unit, scale = 1, label, source, match, paid = false }) {
  if (!file) return null;
  // Data transfer products carry fromRegionCode instead of regionCode.
  const p = one(products(file, (a) => (a.regionCode ?? a.fromRegionCode) === region && match(a)), `${region} ${key}`);
  if (!p) return null;
  const d = firstTier(dimensions(file, p.sku), { paid });
  if (!d) return null;
  return { key, serviceId, usd: round(d.usd * scale), unit, label, sku: p.sku, source, from: 'price-list-bulk' };
}

function round(n) {
  return Number(n.toPrecision(10));
}

const LAMBDA = [
  { key: 'lambda.requests', unit: '1M requests', scale: 1e6, label: 'Lambda requests', match: (a) => a.group === 'AWS-Lambda-Requests' && usage(a, 'Request') },
  { key: 'lambda.gbs.x86', unit: 'GB-second', label: 'Lambda x86, first 6B GB-seconds/month', match: (a) => a.group === 'AWS-Lambda-Duration' && usage(a, 'Lambda-GB-Second') },
  { key: 'lambda.gbs.arm', unit: 'GB-second', label: 'Lambda Arm, first 7.5B GB-seconds/month', match: (a) => a.group === 'AWS-Lambda-Duration-ARM' && usage(a, 'Lambda-GB-Second-ARM') },
].map((s) => ({ ...s, serviceId: 'lambda', source: PAGE.lambda }));

const S3 = [
  {
    key: 's3.standard', unit: 'GB-month', label: 'S3 Standard, first 50 TB',
    match: (a) => a.productFamily === 'Storage' && a.volumeType === 'Standard' && a.storageClass === 'General Purpose' && usage(a, 'TimedStorage-ByteHrs'),
  },
  { key: 's3.put', unit: '1K requests', scale: 1e3, label: 'S3 PUT/COPY/POST/LIST', match: (a) => a.group === 'S3-API-Tier1' && usage(a, 'Requests-Tier1') },
].map((s) => ({ ...s, serviceId: 's3', source: PAGE.s3 }));

const DYNAMODB = [
  { key: 'dynamodb.write', unit: '1M request units', scale: 1e6, label: 'On-demand write request units', match: (a) => a.group === 'DDB-WriteUnits' && usage(a, 'WriteRequestUnits') },
  { key: 'dynamodb.read', unit: '1M request units', scale: 1e6, label: 'On-demand read request units', match: (a) => a.group === 'DDB-ReadUnits' && usage(a, 'ReadRequestUnits') },
  {
    key: 'dynamodb.storage', unit: 'GB-month', paid: true, label: 'Storage, after 25 GB free per Region',
    match: (a) => a.productFamily === 'Database Storage' && a.volumeType === 'Amazon DynamoDB - Indexed DataStore' && usage(a, 'TimedStorage-ByteHrs'),
  },
].map((s) => ({ ...s, serviceId: 'dynamodb', source: PAGE.dynamodb }));

/** The smallest MySQL class: Graviton db.t4g.micro, or db.t3.micro where a Region has no Graviton classes (ca-west-1). */
const RDS = [
  ['rds.micro.single', 'Single-AZ'],
  ['rds.micro.multi', 'Multi-AZ'],
].map(([key, deployment]) =>
  ['db.t4g.micro', 'db.t3.micro'].map((cls) => ({
    key, serviceId: 'rds', unit: 'hour', label: `${cls} MySQL, ${deployment}`, source: PAGE.rds,
    match: (a) =>
      a.productFamily === 'Database Instance' && a.instanceType === cls && a.databaseEngine === 'MySQL' &&
      a.deploymentOption === deployment && a.licenseModel === 'No license required',
  })),
);

const DT = [
  {
    key: 'dt.internet', unit: 'GB', paid: true, label: 'Out to the internet, after 100 GB free',
    match: (a) => a.transferType === 'AWS Outbound' && a.toLocation === 'External' && usage(a, 'DataTransfer-Out-Bytes'),
  },
  {
    key: 'dt.interaz', unit: 'GB', label: 'Between AZs, charged out and in',
    match: (a) => a.transferType === 'IntraRegion' && usage(a, 'DataTransfer-Regional-Bytes'),
  },
].map((s) => ({ ...s, serviceId: 'vpc', source: PAGE.dt }));

/** Inter-Region transfer out: the most common rate to the other commercial Regions, plus a per-destination map. */
function interRegion(region, file, commercial) {
  if (!file) return null;
  const rows = products(file, (a) => a.transferType === 'InterRegion Outbound' && a.fromRegionCode === region && a.toLocationType === 'AWS Region' && commercial.has(a.toRegionCode))
    .map((p) => ({ to: p.attributes.toRegionCode, sku: p.sku, d: firstTier(dimensions(file, p.sku)) }))
    .filter((r) => r.d);
  if (!rows.length) return null;
  const byDestination = Object.fromEntries(rows.sort((a, b) => a.to.localeCompare(b.to)).map((r) => [r.to, round(r.d.usd)]));
  const counts = new Map();
  for (const v of Object.values(byDestination)) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [mode] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  const sku = rows.find((r) => round(r.d.usd) === mode).sku;
  const varies = counts.size > 1;
  return {
    key: 'dt.interregion', serviceId: 'vpc', usd: mode, unit: 'GB', label: varies ? 'Out to another Region (most Regions)' : 'Out to another Region',
    sku, source: PAGE.dt, from: 'price-list-bulk', ...(varies ? { byDestination } : {}),
  };
}

/** Pricing-page metered-unit-map entry → our entry. */
function pageEntry(row, { key, serviceId, unit, label, source }) {
  if (!row) return null;
  const usd = Number(row.price);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return { key, serviceId, usd: round(usd), unit, label, sku: row.rateCode.split('.')[0], source, from: 'pricing-page' };
}

function ec2Entries(page) {
  const out = [];
  for (const type of ['t4g.micro', 't3.micro']) {
    const rows = Object.values(page ?? {}).filter((r) => r['Instance Type'] === type && r['Operating System'] === 'Linux' && (r['Pre Installed S/W'] ?? 'NA') === 'NA');
    out.push({ key: `ec2.${type}`, row: rows.length === 1 ? rows[0] : rows.length ? (warn(`${type}: ${rows.length} rows`), rows[0]) : null, label: `${type}, Linux, On-Demand` });
  }
  return out.map(({ key, row, label }) => [key, pageEntry(row, { key, serviceId: 'ec2', unit: 'hour', label, source: PAGE.ec2 })]);
}

// ---------------------------------------------------------------------------------------------------- main

async function main() {
  const regionsJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'regions.json'), 'utf8'));
  const skipped = [];
  const codes = [];
  for (const r of regionsJson.regions) {
    const other = OTHER_PARTITIONS.find(([re]) => re.test(r.code));
    if (other) skipped.push({ region: r.code, reason: other[1] });
    else codes.push(r);
  }
  const commercial = new Set(codes.map((r) => r.code));
  console.log(`${codes.length} commercial Regions; skipping ${skipped.map((s) => s.region).join(', ')}`);

  // Page-loaded unit maps (location-keyed, all Regions in one file for EBS and NAT gateway).
  const ebsMap = await getJson(`${UNIT_MAPS}/ec2/USD/current/ebs.json`, 'pages/ebs.json');
  const natMap = await getJson(`${UNIT_MAPS}/ec2/USD/current/natgateway.json`, 'pages/natgateway.json');

  const regions = {};
  await pool(codes, 4, async (r) => {
    const code = r.code;
    const [lambda, s3, ddb, rds, dt] = await Promise.all(['AWSLambda', 'AmazonS3', 'AmazonDynamoDB', 'AmazonRDS', 'AWSDataTransfer'].map((o) => offerFile(o, code)));

    // code → Price List `location`, from the data itself.
    let location;
    for (const f of [lambda, s3, ddb, dt]) {
      const p = f && Object.values(f.products).find((p) => p.attributes.regionCode === code && p.attributes.locationType === 'AWS Region' && p.attributes.location);
      if (p) { location = p.attributes.location; break; }
    }
    if (!location) {
      warn(`${code}: no Price List location found; skipping`);
      return;
    }
    if (location !== r.name) console.log(`  ${code}: Price List location "${location}" (regions.json says "${r.name}")`);

    // The pricing pages sometimes keep an older name for the same location ("EU (Zurich)" for "Europe (Zurich)").
    const names = [...new Set([location, location.replace(/^Europe \(/, 'EU (')])];
    let ec2Rows;
    for (const name of names) {
      const page = await getJson(
        `${UNIT_MAPS}/ec2/USD/current/ec2-ondemand-without-sec-sel/${encodeURIComponent(name)}/Linux/index.json`,
        `pages/ec2/${name.replace(/[^A-Za-z0-9.-]+/g, '_')}.json`,
      );
      if (page?.regions?.[name]) {
        ec2Rows = page.regions[name];
        break;
      }
    }
    if (!ec2Rows) warn(`${code}: no EC2 On-Demand page data for "${names.join('" / "')}"`);
    const pageRow = (map) => names.map((n) => map?.regions?.[n]).find(Boolean);

    const want = [];
    const add = (key, e) => want.push([key, e]);
    for (const [k, e] of ec2Entries(ec2Rows)) add(k, e);
    add('ebs.gp3', pageEntry(pageRow(ebsMap)?.['Storage General Purpose gp3 GB Mo'], { key: 'ebs.gp3', serviceId: 'ebs', unit: 'GB-month', label: 'gp3 volume storage', source: PAGE.ebs }));
    for (const s of LAMBDA) add(s.key, bulkEntry(code, lambda, s));
    for (const s of S3) add(s.key, bulkEntry(code, s3, s));
    for (const s of DYNAMODB) add(s.key, bulkEntry(code, ddb, s));
    for (const [graviton, t3] of RDS) add(graviton.key, bulkEntry(code, rds, graviton) ?? bulkEntry(code, rds, t3));
    const nat = pageRow(natMap);
    add('vpc.nat.hour', pageEntry(nat?.['Hourly charge for NAT Gateways'], { key: 'vpc.nat.hour', serviceId: 'vpc', unit: 'hour', label: 'NAT gateway, per hour', source: PAGE.vpc }));
    add('vpc.nat.gb', pageEntry(nat?.['Charge for per GB data processed by NatGateways'], { key: 'vpc.nat.gb', serviceId: 'vpc', unit: 'GB', label: 'NAT gateway, per GB processed', source: PAGE.vpc }));
    for (const s of DT) add(s.key, bulkEntry(code, dt, s));
    add('dt.interregion', interRegion(code, dt, commercial));

    const entries = [];
    for (const [key, e] of want) {
      if (e) entries.push(e);
      else warn(`${code}: no price for ${key}`);
    }
    regions[code] = entries;
    console.log(`  ${code}: ${entries.length}/${want.length} prices`);
  });

  const sorted = Object.fromEntries(Object.keys(regions).sort().map((k) => [k, regions[k]]));
  const doc = {
    source: 'AWS Price List Bulk API + the EC2 On-Demand pricing page data',
    asOf: new Date().toISOString().slice(0, 10),
    currency: 'USD',
    note: 'List prices before tax, Free Tier, Savings Plans and Reserved pricing. First usage tier where tiered.',
    skipped,
    regions: sorted,
  };
  fs.writeFileSync(OUT, format(doc));
  console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB, ${Object.keys(sorted).length} Regions, ${warnings.length} warnings)`);
}

/** Pretty at the top level, one entry per line. */
function format(doc) {
  const { regions, skipped, ...head } = doc;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  lines.push(`  "skipped": [\n${skipped.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ],`);
  const rs = Object.entries(regions).map(([code, es]) => `    ${JSON.stringify(code)}: [\n${es.map((e) => `      ${JSON.stringify(e)}`).join(',\n')}\n    ]`);
  lines.push(`  "regions": {\n${rs.join(',\n')}\n  }`);
  return `{\n${lines.join('\n')}\n}\n`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
