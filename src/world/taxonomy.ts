// Districts (AWS categories) → services. Pure data: add a service here + a place in places.ts
// and it appears in the city. Nothing in game/ or ui/ hard-codes service ids.

export type DistrictId = 'storage' | 'compute' | 'database' | 'networking' | 'security' | 'aiml';

export interface District {
  id: DistrictId;
  name: string;
  /** Primary colour used for roofs, shirts, walls. */
  color: number;
  /** Name of the district HQ (the Habbo-style interior room). */
  hq: string;
}

export interface Service {
  id: string;
  name: string;
  districtId: DistrictId;
  /** Path segment after console.aws.amazon.com/ (e.g. "s3" matches /s3/buckets). */
  consolePaths: string[];
  /** Path segment after docs.aws.amazon.com/ (e.g. "AmazonS3"). */
  docsPaths: string[];
  /** Words that route a free-text prompt or page title to this service. */
  keywords: string[];
}

export const DISTRICTS: District[] = [
  { id: 'storage', name: 'Storage Shores', color: 0x3f9b4f, hq: 'Storage HQ' },
  { id: 'compute', name: 'Compute Quarter', color: 0xe8912d, hq: 'Compute HQ' },
  { id: 'database', name: 'Database Row', color: 0x3a6fd8, hq: 'Database HQ' },
  { id: 'networking', name: 'Network Junction', color: 0x8b5cf6, hq: 'Networking HQ' },
  { id: 'security', name: 'Security Keep', color: 0xd64545, hq: 'Security HQ' },
  { id: 'aiml', name: 'AI Heights', color: 0x14b8a6, hq: 'AI/ML HQ' },
];

export const SERVICES: Service[] = [
  // Storage
  { id: 's3', name: 'Amazon S3', districtId: 'storage', consolePaths: ['s3'], docsPaths: ['AmazonS3'], keywords: ['s3', 'bucket', 'object', 'upload', 'file', 'photo', 'image', 'backup', 'store', 'storage'] },
  { id: 'ebs', name: 'Amazon EBS', districtId: 'storage', consolePaths: ['ebs'], docsPaths: ['ebs'], keywords: ['ebs', 'volume', 'block storage', 'disk', 'snapshot'] },
  { id: 'efs', name: 'Amazon EFS', districtId: 'storage', consolePaths: ['efs'], docsPaths: ['efs'], keywords: ['efs', 'file system', 'nfs', 'shared files'] },
  // Compute
  { id: 'ec2', name: 'Amazon EC2', districtId: 'compute', consolePaths: ['ec2'], docsPaths: ['AWSEC2', 'ec2'], keywords: ['ec2', 'instance', 'server', 'virtual machine', 'vm', 'ami'] },
  { id: 'lambda', name: 'AWS Lambda', districtId: 'compute', consolePaths: ['lambda'], docsPaths: ['lambda'], keywords: ['lambda', 'function', 'serverless', 'trigger', 'event', 'run code', 'code', 'when a file'] },
  { id: 'ecs', name: 'Amazon ECS', districtId: 'compute', consolePaths: ['ecs', 'eks'], docsPaths: ['AmazonECS', 'eks'], keywords: ['ecs', 'eks', 'container', 'docker', 'kubernetes', 'fargate'] },
  // Database
  { id: 'dynamodb', name: 'Amazon DynamoDB', districtId: 'database', consolePaths: ['dynamodbv2', 'dynamodb'], docsPaths: ['amazondynamodb'], keywords: ['dynamodb', 'dynamo', 'nosql', 'key-value', 'partition key', 'table'] },
  { id: 'rds', name: 'Amazon RDS', districtId: 'database', consolePaths: ['rds'], docsPaths: ['AmazonRDS'], keywords: ['rds', 'postgres', 'mysql', 'relational', 'sql', 'database'] },
  { id: 'aurora', name: 'Amazon Aurora', districtId: 'database', consolePaths: ['rds/aurora'], docsPaths: ['AmazonRDS/latest/AuroraUserGuide'], keywords: ['aurora', 'serverless v2', 'global database'] },
  // Networking
  { id: 'route53', name: 'Amazon Route 53', districtId: 'networking', consolePaths: ['route53'], docsPaths: ['Route53'], keywords: ['route 53', 'route53', 'dns', 'domain', 'hosted zone', 'record'] },
  { id: 'vpc', name: 'Amazon VPC', districtId: 'networking', consolePaths: ['vpc', 'vpcconsole'], docsPaths: ['vpc'], keywords: ['vpc', 'subnet', 'network', 'security group', 'nat', 'private'] },
  { id: 'cloudfront', name: 'Amazon CloudFront', districtId: 'networking', consolePaths: ['cloudfront'], docsPaths: ['AmazonCloudFront'], keywords: ['cloudfront', 'cdn', 'cache', 'edge', 'distribution'] },
  // Security
  { id: 'shield', name: 'AWS Shield', districtId: 'security', consolePaths: ['wafv2/shield', 'shield'], docsPaths: ['waf/latest/developerguide/shield'], keywords: ['shield', 'ddos', 'attack', 'waf', 'protect'] },
  { id: 'iam', name: 'AWS IAM', districtId: 'security', consolePaths: ['iam', 'iamv2'], docsPaths: ['IAM'], keywords: ['iam', 'role', 'policy', 'permission', 'user', 'access'] },
  { id: 'kms', name: 'AWS KMS', districtId: 'security', consolePaths: ['kms'], docsPaths: ['kms'], keywords: ['kms', ' key ', 'encrypt', 'encryption', 'secret'] },
  // AI / ML
  { id: 'bedrock', name: 'Amazon Bedrock', districtId: 'aiml', consolePaths: ['bedrock'], docsPaths: ['bedrock'], keywords: ['bedrock', 'llm', 'claude', 'generative', 'genai', 'prompt', 'model'] },
  { id: 'sagemaker', name: 'Amazon SageMaker', districtId: 'aiml', consolePaths: ['sagemaker'], docsPaths: ['sagemaker'], keywords: ['sagemaker', 'train', 'training', 'notebook', 'machine learning', ' ml '] },
  { id: 'rekognition', name: 'Amazon Rekognition', districtId: 'aiml', consolePaths: ['rekognition'], docsPaths: ['rekognition'], keywords: ['rekognition', 'face', 'vision', 'label', 'detect', 'recognise', 'recognize'] },
];

export const serviceById = (id: string) => SERVICES.find((s) => s.id === id);
export const districtById = (id: string) => DISTRICTS.find((d) => d.id === id);
export const servicesIn = (districtId: DistrictId) => SERVICES.filter((s) => s.districtId === districtId);

export type PageKind = 'console-home' | 'console' | 'docs' | 'other' | 'extension';

export interface PageMatch {
  kind: PageKind;
  serviceId?: string;
}

/** Map a browser URL to an AWS service. Longest matching path wins (so rds/aurora beats rds). */
export function matchUrl(rawUrl: string): PageMatch {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'other' };
  }
  if (url.protocol === 'chrome-extension:' || url.protocol === 'chrome:') return { kind: 'extension' };
  const host = url.hostname;
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const hash = url.hash.replace(/^#\/?/, '');

  const best = (field: 'consolePaths' | 'docsPaths', candidate: string) => {
    let winner: { id: string; len: number } | undefined;
    for (const s of SERVICES) {
      for (const p of s[field]) {
        const lower = p.toLowerCase();
        const c = candidate.toLowerCase();
        if ((c === lower || c.startsWith(lower + '/') || c.startsWith(lower + '?')) && (!winner || lower.length > winner.len)) {
          winner = { id: s.id, len: lower.length };
        }
      }
    }
    return winner?.id;
  };

  if (host === 'console.aws.amazon.com' || host.endsWith('.console.aws.amazon.com')) {
    if (path === '' || path.startsWith('console/home')) return { kind: 'console-home' };
    // Some consoles route via hash (e.g. /rds/home#aurora); try path + hash.
    const serviceId = best('consolePaths', path.split('/home')[0] + (hash ? '/' + hash : '')) ?? best('consolePaths', path);
    return { kind: 'console', serviceId };
  }
  if (host === 'docs.aws.amazon.com') return { kind: 'docs', serviceId: best('docsPaths', path) };
  return { kind: 'other' };
}

/** Keyword routing for free text (prompts, page titles). Returns best service id or undefined. */
export function matchText(text: string): string | undefined {
  const t = ` ${text.toLowerCase()} `;
  let winner: { id: string; score: number } | undefined;
  for (const s of SERVICES) {
    let score = 0;
    for (const k of s.keywords) if (t.includes(k)) score += k.length;
    if (score > 0 && (!winner || score > winner.score)) winner = { id: s.id, score };
  }
  return winner?.id;
}

export const hexColor = (n: number) => '#' + n.toString(16).padStart(6, '0');
