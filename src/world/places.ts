// Every service is a themed place whose metaphor teaches what the service does.
// Agent `activity` picks the working animation (see game/sprites.ts); `kind` picks the landmark art.

export type ActivityKind =
  | 'type' // sat at a computer typing
  | 'fish' // rod + bobbing line
  | 'guard' // shield raised
  | 'dance' // arms up, bouncing
  | 'cook' // pan flipping
  | 'file' // stacking index cards / books
  | 'hammer' // building / assembling
  | 'scan' // camera / magnifier
  | 'think' // pondering, thought dots
  | 'carry' // carrying crates
  | 'check' // checking badges with clipboard
  | 'lock'; // turning a big key

export type LandmarkKind = 'building' | 'lake' | 'wall' | 'tower' | 'garden' | 'stall' | 'dome' | 'dock';

export interface Place {
  serviceId: string;
  place: string;
  kind: LandmarkKind;
  agentName: string;
  activity: ActivityKind;
  /** One-line hook shown on the landmark card. */
  blurb: string;
  /** Concepts the landmark teaches, Foundation → Expert. */
  teaches: string[];
  /** What unlocking each tier means: [Foundation, Associate, Professional, Expert]. */
  tiers: [string, string, string, string];
  /** Mini-game scene key, if the place is playable. */
  game?: 'fishing';
}

export const PLACES: Place[] = [
  // Storage
  { serviceId: 's3', place: 'S3 Lake', kind: 'lake', agentName: 'Sally the Angler', activity: 'fish', game: 'fishing',
    blurb: 'Every fish is an object; every net is a bucket. Cast a line to fetch one back.',
    teaches: ['Objects live in buckets, addressed by key', 'Storage classes trade price for access speed', 'Lifecycle rules move old objects to Glacier', 'Versioning, replication and presigned URLs'],
    tiers: ['You know what a bucket and an object are', 'You can pick the right storage class', 'You design lifecycle and access policies', 'You architect multi-region, event-driven storage'] },
  { serviceId: 'ebs', place: 'EBS Lockers', kind: 'building', agentName: 'Bex the Keeper', activity: 'carry',
    blurb: 'A locker bolted to one server — fast, private, and it goes where the instance goes.',
    teaches: ['Block volumes attach to one EC2 instance', 'gp3 vs io2 performance', 'Snapshots back up to S3', 'Multi-attach and encryption at rest'],
    tiers: ['You know a volume is a disk for EC2', 'You size gp3 IOPS/throughput', 'You automate snapshots with DLM', 'You tune io2 for databases'] },
  { serviceId: 'efs', place: 'EFS Shared Well', kind: 'dome', agentName: 'Effie the Well-keeper', activity: 'carry',
    blurb: 'One well, many buckets drawing from it at once — a file system shared by many servers.',
    teaches: ['NFS shared across instances and AZs', 'Elastic capacity, pay per GB', 'Storage classes and lifecycle', 'Access points and throughput modes'],
    tiers: ['You know EFS is shared files', 'You mount it on several instances', 'You use access points', 'You tune throughput modes'] },
  // Compute
  { serviceId: 'ec2', place: 'EC2 Factory', kind: 'building', agentName: 'Eddie the Engineer', activity: 'hammer',
    blurb: 'Rent a machine by the hour. Pick its size, boot it from an AMI, keep it running.',
    teaches: ['Instances, AMIs and instance types', 'Security groups and key pairs', 'Auto Scaling and load balancers', 'Spot, Savings Plans and placement'],
    tiers: ['You can launch an instance', 'You pick the right instance family', 'You build auto-scaling fleets', 'You optimise cost with Spot and Graviton'] },
  { serviceId: 'lambda', place: 'Lambda Food Stall', kind: 'stall', agentName: 'Lola the Chef', activity: 'cook',
    blurb: 'The stall only fires up the grill when an order arrives — you pay per dish, not per hour.',
    teaches: ['Functions run on events', 'Pay per request and duration', 'Cold starts, concurrency and timeouts', 'Event sources, destinations and layers'],
    tiers: ['You know serverless means no servers to manage', 'You wire triggers from S3/API Gateway', 'You tune memory, concurrency and retries', 'You design event-driven architectures'] },
  { serviceId: 'ecs', place: 'ECS Shipping Docks', kind: 'dock', agentName: 'Captain Cass', activity: 'carry',
    blurb: 'Containers stacked on ships — ECS and EKS decide which ship carries which box.',
    teaches: ['Containers package app + dependencies', 'Tasks, services and clusters', 'Fargate removes the servers', 'EKS for Kubernetes workloads'],
    tiers: ['You know what a container is', 'You run a service on Fargate', 'You design task networking and scaling', 'You operate EKS in production'] },
  // Database
  { serviceId: 'dynamodb', place: 'DynamoDB Library', kind: 'building', agentName: 'Dyna the Librarian', activity: 'file',
    blurb: 'Tell the librarian the exact card number and she returns it in milliseconds — any scale.',
    teaches: ['Tables, items and primary keys', 'Partition keys spread the load', 'GSIs for other access patterns', 'Single-table design and streams'],
    tiers: ['You know DynamoDB is key-value', 'You choose good partition keys', 'You model access patterns with GSIs', 'You do single-table design'] },
  { serviceId: 'rds', place: 'RDS Records Hall', kind: 'building', agentName: 'Ray the Clerk', activity: 'type',
    blurb: 'A tidy hall of ledgers with rows and columns — managed Postgres, MySQL and friends.',
    teaches: ['Managed relational engines', 'Multi-AZ for availability', 'Read replicas for scale', 'Backups, PITR and parameter groups'],
    tiers: ['You know RDS runs SQL databases for you', 'You enable Multi-AZ and backups', 'You scale with read replicas', 'You tune performance insights'] },
  { serviceId: 'aurora', place: 'Aurora Observatory', kind: 'dome', agentName: 'Rory the Astronomer', activity: 'think',
    blurb: 'Same stars as RDS, but a bigger telescope — storage that grows itself across three AZs.',
    teaches: ['MySQL/Postgres compatible', 'Six copies of storage across 3 AZs', 'Aurora Serverless v2', 'Global Database for multi-region'],
    tiers: ['You know Aurora is cloud-native SQL', 'You use reader endpoints', 'You run Serverless v2', 'You design Global Database failover'] },
  // Networking
  { serviceId: 'route53', place: 'Route 53 Dance Hall', kind: 'building', agentName: 'Ruby the Dance Caller', activity: 'dance',
    blurb: 'Every dancer asks "who is my partner?" — Ruby calls out the address. That is DNS.',
    teaches: ['DNS turns names into IPs', 'Hosted zones and records', 'Routing policies: weighted, latency, failover', 'Health checks and private zones'],
    tiers: ['You know what DNS does', 'You create records in a hosted zone', 'You use routing policies', 'You design multi-region failover'] },
  { serviceId: 'vpc', place: 'VPC Walled Garden', kind: 'garden', agentName: 'Vic the Gardener', activity: 'hammer',
    blurb: 'Your own walled garden in the cloud — you decide the paths, gates and who gets in.',
    teaches: ['CIDR blocks and subnets', 'Public vs private subnets, IGW and NAT', 'Security groups vs NACLs', 'Peering, Transit Gateway and endpoints'],
    tiers: ['You know a VPC is your private network', 'You build public/private subnets', 'You secure with SGs and NACLs', 'You connect VPCs at scale'] },
  { serviceId: 'cloudfront', place: 'CloudFront Post Office', kind: 'building', agentName: 'Cleo the Courier', activity: 'carry',
    blurb: 'Copies of your parcels wait in post offices worldwide, so delivery is always local.',
    teaches: ['Edge locations cache content', 'Origins: S3, ALB, custom', 'Cache behaviours and TTLs', 'Signed URLs, OAC and edge functions'],
    tiers: ['You know a CDN caches near users', 'You front S3 with CloudFront', 'You tune cache behaviours', 'You run logic at the edge'] },
  // Security
  { serviceId: 'shield', place: 'Shield Wall', kind: 'wall', agentName: 'Sir Shieldon', activity: 'guard',
    blurb: 'When a storm of arrows (DDoS) hits, the wall takes it so your castle keeps running.',
    teaches: ['DDoS attacks flood your app', 'Shield Standard is free and automatic', 'Shield Advanced adds response team + cost protection', 'Pair with WAF and CloudFront'],
    tiers: ['You know what a DDoS attack is', 'You know Standard vs Advanced', 'You combine Shield with WAF', 'You plan DDoS-resilient architectures'] },
  { serviceId: 'iam', place: 'IAM Gatehouse', kind: 'tower', agentName: 'Ivy the Gatekeeper', activity: 'check',
    blurb: 'Nobody passes without a badge. Ivy checks who you are and what you are allowed to do.',
    teaches: ['Users, groups and roles', 'Policies: allow, deny, least privilege', 'Roles for services and cross-account', 'Permission boundaries and SCPs'],
    tiers: ['You know identity vs permission', 'You write least-privilege policies', 'You use roles everywhere', 'You govern with SCPs and boundaries'] },
  { serviceId: 'kms', place: 'KMS Vault', kind: 'building', agentName: 'Kit the Locksmith', activity: 'lock',
    blurb: 'The master keys never leave the vault — Kit lends out copies to lock and unlock your data.',
    teaches: ['Encryption keys managed for you', 'Envelope encryption', 'Key policies and grants', 'Rotation and multi-region keys'],
    tiers: ['You know KMS holds encryption keys', 'You encrypt S3/EBS with KMS', 'You write key policies', 'You design envelope encryption'] },
  // AI / ML
  { serviceId: 'bedrock', place: 'Bedrock Oracle', kind: 'tower', agentName: 'Bede the Oracle', activity: 'think',
    blurb: 'Ask the oracle anything — it consults foundation models like Claude and answers.',
    teaches: ['Foundation models via one API', 'Prompts, tokens and inference', 'Knowledge Bases (RAG) and Agents', 'Guardrails and model evaluation'],
    tiers: ['You know what a foundation model is', 'You call models from code', 'You build RAG with Knowledge Bases', 'You ship guarded, evaluated agents'] },
  { serviceId: 'sagemaker', place: 'SageMaker Workshop', kind: 'building', agentName: 'Sage the Tinkerer', activity: 'hammer',
    blurb: 'Where models are built by hand — gather data, train, tune and deploy.',
    teaches: ['Notebooks and training jobs', 'Built-in algorithms and containers', 'Endpoints for inference', 'Pipelines and MLOps'],
    tiers: ['You know ML needs training data', 'You run a training job', 'You deploy an endpoint', 'You automate MLOps pipelines'] },
  { serviceId: 'rekognition', place: 'Rekognition Gallery', kind: 'building', agentName: 'Rex the Curator', activity: 'scan',
    blurb: 'Rex looks at every picture and tells you what is in it — faces, objects, text.',
    teaches: ['Label detection in images', 'Face detection and comparison', 'Video analysis', 'Custom Labels and responsible use'],
    tiers: ['You know computer vision basics', 'You detect labels in S3 images', 'You analyse video streams', 'You train Custom Labels'] },
];

export const placeFor = (serviceId: string) => PLACES.find((p) => p.serviceId === serviceId);

/** Special agents that aren't tied to a service. */
export const SPECIAL_AGENTS = {
  concierge: { id: 'concierge', name: 'Connie the Concierge', activity: 'check' as ActivityKind, color: 0xf2c94c, role: 'Receives your requests at Console Plaza and dispatches the right agent.' },
  lookout: { id: 'lookout', name: 'Luke the Lookout', activity: 'scan' as ActivityKind, color: 0x94a3b8, role: 'Snaps screenshots of the page you are on so the city can see it.' },
} as const;

export const TIER_NAMES = ['Construction site', 'Foundation', 'Associate', 'Professional', 'Expert'] as const;
/** XP needed to reach tier index i (tier 0 = discovered). */
export const TIER_XP = [0, 10, 40, 100, 200] as const;

export function tierForXp(xp: number): number {
  let t = 0;
  for (let i = 0; i < TIER_XP.length; i++) if (xp >= TIER_XP[i]) t = i;
  return t;
}
