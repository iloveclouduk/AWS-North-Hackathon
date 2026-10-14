// Downloads the public AWS Architecture Icons asset package and copies the 48px service icon of each of our
// services into public/assets/aws-icons/<serviceId>.svg (and the diagram group and actor icons into groups/ and res/), plus a NOTICE and shared/aws-icons.json (the manifest
// the UI and the city read; only ids listed there are shown).
//
// Usage: npm run icons            (AWS_ICONS_ZIP_URL=<zip> to pin a package; or drop the zip at .cache/aws-icons/pkg.zip)
// No dependencies: uses fetch + the system `unzip`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = 'https://aws.amazon.com/architecture/icons/';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'aws-icons');
const OUT = path.join(ROOT, 'public', 'assets', 'aws-icons');
const MANIFEST = path.join(ROOT, 'shared', 'aws-icons.json');

/** Our service id → base name of the package's Architecture-Service-Icons file (Arch_<name>_48.svg). */
export const MAPPING = {
  ec2: 'Amazon-EC2',
  lambda: 'AWS-Lambda',
  ecs: 'Amazon-Elastic-Container-Service',
  fargate: 'AWS-Fargate',
  eks: 'Amazon-Elastic-Kubernetes-Service',
  beanstalk: 'AWS-Elastic-Beanstalk',
  s3: 'Amazon-Simple-Storage-Service',
  ebs: 'Amazon-Elastic-Block-Store',
  efs: 'Amazon-EFS',
  glue: 'AWS-Glue',
  athena: 'Amazon-Athena',
  lakeformation: 'AWS-Lake-Formation',
  dynamodb: 'Amazon-DynamoDB',
  rds: 'Amazon-RDS',
  aurora: 'Amazon-Aurora',
  elasticache: 'Amazon-ElastiCache',
  redshift: 'Amazon-Redshift',
  neptune: 'Amazon-Neptune',
  vpc: 'Amazon-Virtual-Private-Cloud',
  route53: 'Amazon-Route-53',
  cloudfront: 'Amazon-CloudFront',
  apigateway: 'Amazon-API-Gateway',
  sqs: 'Amazon-Simple-Queue-Service', // "SQS & SNS": SNS is Amazon-Simple-Notification-Service
  eventbridge: 'Amazon-EventBridge',
  iam: 'AWS-Identity-and-Access-Management',
  cognito: 'Amazon-Cognito',
  kms: 'AWS-Key-Management-Service',
  shield: 'AWS-Shield', // "Shield & WAF": WAF is AWS-WAF
  guardduty: 'Amazon-GuardDuty',
  cloudwatch: 'Amazon-CloudWatch', // "CloudWatch & CloudTrail": CloudTrail is AWS-CloudTrail
  bedrock: 'Amazon-Bedrock',
  agentcore: 'Amazon-Bedrock-AgentCore',
  sagemaker: 'Amazon-SageMaker-AI',
  q: 'Amazon-Q',
  rekognition: 'Amazon-Rekognition',
  textract: 'Amazon-Textract',
};

/** Diagram group boxes (Architecture-Group-Icons) and actors (Resource-Icons, General): kind → package file name.
 *  The UI is dark, so the _Dark variants are picked where the package has one. */
export const GROUPS = {
  cloud: 'AWS-Cloud-logo_32_Dark.svg',
  region: 'Region_32.svg',
  vpc: 'Virtual-private-cloud-VPC_32.svg',
  public: 'Public-subnet_32.svg',
  private: 'Private-subnet_32.svg',
};
export const RESOURCES = {
  users: 'Res_Users_48_Dark.svg',
  client: 'Res_Client_48_Dark.svg',
  mobile: 'Res_Mobile-client_48_Dark.svg',
  internet: 'Res_Internet-alt1_48_Dark.svg',
  admin: 'Res_AWS-Management-Console_48_Dark.svg',
  sources: 'Res_Generic-Application_48_Dark.svg',
};

/** Products a diagram box can show inside a combined landmark (CloudTrail on "CloudWatch & CloudTrail"…) or as a
 *  fixed, pre-built box (a load balancer): id → [package file name, display name]. */
export const PRODUCTS = {
  cloudtrail: ['Arch_AWS-CloudTrail_48.svg', 'AWS CloudTrail'],
  sns: ['Arch_Amazon-Simple-Notification-Service_48.svg', 'Amazon SNS'],
  waf: ['Arch_AWS-WAF_48.svg', 'AWS WAF'],
  alb: ['Res_Elastic-Load-Balancing_Application-Load-Balancer_48.svg', 'Application Load Balancer'],
  kb: ['Arch_Amazon-Bedrock_48.svg', 'Bedrock knowledge base'],
};

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n\nManual fallback: download the "Asset package" zip from ${PAGE}\nand save it as .cache/aws-icons/pkg.zip (or set AWS_ICONS_ZIP_URL), then re-run npm run icons.\nExisting outputs were left untouched.`);
  process.exit(1);
};

async function zipUrl() {
  if (process.env.AWS_ICONS_ZIP_URL) return process.env.AWS_ICONS_ZIP_URL;
  const res = await fetch(PAGE, { headers: { 'user-agent': 'Mozilla/5.0 (aws-city icon fetch)' } }).catch((e) => fail(`Couldn't reach ${PAGE}: ${e.message}`));
  if (!res.ok) fail(`${PAGE} answered HTTP ${res.status}`);
  const html = await res.text();
  const zips = [...new Set(html.match(/https:\/\/[^"'\s]+?\.zip/g) ?? [])].filter((u) => /awsstatic\.com/.test(u));
  const pkg = zips.find((u) => /icon-package|asset-package/i.test(u)) ?? zips.find((u) => !/pptx|keynote|toolkit/i.test(u));
  if (!pkg) fail(`No asset-package .zip link found on ${PAGE} (the page layout may have changed).`);
  return pkg;
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === '__MACOSX' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const url = await zipUrl();
fs.mkdirSync(CACHE, { recursive: true });
const zip = path.join(CACHE, 'pkg.zip');
const stamp = path.join(CACHE, 'pkg.url');
if (!fs.existsSync(zip) || (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') !== url && !process.env.AWS_ICONS_KEEP_ZIP)) {
  console.log('downloading', url);
  const res = await fetch(url).catch((e) => fail(`Download failed: ${e.message}`));
  if (!res.ok) fail(`Download failed: HTTP ${res.status} for ${url}`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  fs.writeFileSync(stamp, url);
} else console.log('using cached', path.relative(ROOT, zip));

const pkgDir = path.join(CACHE, 'pkg');
fs.rmSync(pkgDir, { recursive: true, force: true });
try {
  execFileSync('unzip', ['-o', '-q', zip, '-d', pkgDir]);
} catch (e) {
  fail(`unzip failed (${e.message}); is the zip complete and is \`unzip\` installed?`);
}
const all = walk(pkgDir).filter((f) => f.endsWith('.svg') && !path.basename(f).startsWith('._'));
const files = all.filter((f) => f.includes('Architecture-Service-Icons'));

const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'world.json'), 'utf8'));
const picked = {};
const missing = [];
for (const s of world.services) {
  const base = MAPPING[s.id];
  if (!base) {
    missing.push(`${s.id} (no MAPPING entry)`);
    continue;
  }
  const sizes = [48, 64, 32, 16];
  const hit = sizes.map((n) => files.find((f) => path.basename(f) === `Arch_${base}_${n}.svg`)).find(Boolean);
  if (!hit) missing.push(`${s.id} → Arch_${base}_48.svg`);
  else picked[s.id] = hit;
}
const extra = (table, dir) =>
  Object.fromEntries(
    Object.entries(table).map(([id, name]) => {
      const hit = all.find((f) => f.includes(dir) && path.basename(f) === name);
      if (!hit) missing.push(`${id} → ${name}`);
      return [id, hit];
    }),
  );
const pickedGroups = extra(GROUPS, 'Architecture-Group-Icons');
const pickedResources = extra(RESOURCES, 'Resource-Icons');
const pickedProducts = extra(Object.fromEntries(Object.entries(PRODUCTS).map(([id, [file]]) => [id, file])), '');
if (missing.length) fail(`Mapped icons not found in the package:\n  ${missing.join('\n  ')}\nUpdate MAPPING in scripts/fetch-aws-icons.mjs.`);

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { recursive: true });
const asOf = new Date().toISOString().slice(0, 10);
const icons = {};
for (const [id, file] of Object.entries(picked)) {
  fs.copyFileSync(file, path.join(OUT, `${id}.svg`));
  icons[id] = { file: path.relative(pkgDir, file), path: `/assets/aws-icons/${id}.svg` };
}
const copyAll = (picked, sub) => {
  fs.mkdirSync(path.join(OUT, sub), { recursive: true });
  return Object.fromEntries(
    Object.entries(picked).map(([id, file]) => {
      fs.copyFileSync(file, path.join(OUT, sub, `${id}.svg`));
      return [id, { file: path.relative(pkgDir, file), path: `/assets/aws-icons/${sub}/${id}.svg` }];
    }),
  );
};
const groups = copyAll(pickedGroups, 'groups');
const resources = copyAll(pickedResources, 'res');
const products = Object.fromEntries(Object.entries(copyAll(pickedProducts, 'products')).map(([id, v]) => [id, { ...v, name: PRODUCTS[id][1] }]));
fs.writeFileSync(
  path.join(OUT, 'NOTICE'),
  `AWS Architecture Icons
Source page: ${PAGE}
Package: ${url}
Downloaded: ${asOf}

These icons are the property of Amazon Web Services, Inc. and are provided for use in architecture
diagrams under AWS's terms (see the source page). They are not part of this project's license.
`,
);
fs.writeFileSync(MANIFEST, JSON.stringify({ source: PAGE, zip: url, asOf, icons, groups, resources, products }, null, 1) + '\n');
console.log(`✓ ${Object.keys(icons).length} icons → ${path.relative(ROOT, OUT)} (manifest ${path.relative(ROOT, MANIFEST)})`);
