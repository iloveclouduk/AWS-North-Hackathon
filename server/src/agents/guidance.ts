/**
 * Short, beginner-sized AWS best practices per agent, so every answer leans Well-Architected.
 *
 * Adapted from the Agent Toolkit for AWS skills (https://github.com/aws/agent-toolkit-for-aws,
 * skills/core-skills/*, Apache-2.0, Copyright Amazon.com, Inc. or its affiliates) and the AWS
 * Well-Architected Framework. Kept deliberately small: agents speak in 80-word bubbles, and
 * live documentation arrives separately in <aws_docs>.
 */
const GENERAL = [
  'Prefer secure, cheap defaults: least privilege, encryption on, nothing public unless the player really needs it.',
  'Check the documentation rather than guessing; when you use a fact from <aws_docs>, mention the page title.',
  'Tag what you build and clean up what you no longer use (idle resources still cost money).',
  'Never ask for, read or repeat secrets, access keys or passwords.',
];

const BY_SERVICE: Record<string, string[]> = {
  ec2: [
    'Graviton (t4g) gives the best price-performance for small Linux workloads.',
    'T3/T3a/T4g default to "unlimited" CPU credits, which can bill surplus credits; the city launches them in "standard" mode.',
    'Require IMDSv2 (token-based instance metadata) — it blocks a common credential-theft path.',
    'Don\'t open SSH (port 22) to 0.0.0.0/0; use Session Manager instead of keys where possible.',
    'Stop instances you are not using; terminate the ones you no longer need.',
  ],
  s3: [
    'Block Public Access is on by default for new buckets; keep it on unless you are deliberately hosting public files.',
    'All new objects are encrypted at rest by default (SSE-S3); use SSE-KMS when you need key control and audit.',
    'Grant access with IAM or bucket policies, not ACLs (Object Ownership "bucket owner enforced").',
    'Use lifecycle rules to move or expire old data, and versioning to protect against accidental deletes.',
  ],
  dynamodb: [
    'Design keys from the questions you will ask (access patterns) before creating the table.',
    'On-demand capacity is simplest and costs ~nothing when idle; provisioned + auto scaling suits steady traffic.',
    'Turn on point-in-time recovery for data you care about; tables are always encrypted at rest.',
    'Avoid scans on big tables — query by key, or add a secondary index.',
  ],
  lambda: [
    'Give each function its own least-privilege execution role.',
    'Keep functions small and stateless; set sensible timeouts and memory (more memory also means more CPU).',
    'Stay on supported runtimes; deprecated runtimes stop getting security patches.',
  ],
  iam: [
    'Use roles and temporary credentials, not long-lived access keys.',
    'Grant least privilege, and turn on MFA for people, especially the root user (which should not be used day to day).',
  ],
  vpc: ['Keep databases and back ends in private subnets; security groups should allow only the ports and sources needed.'],
  rds: ['Use Multi-AZ for production, keep automated backups on, and never make a database publicly accessible.'],
  cloudwatch: ['Set alarms on what matters to users, and send logs somewhere with a retention period so they don\'t grow forever.'],
  bedrock: ['Pick the smallest model that does the job well, and keep prompts and data out of logs.'],
};

/** The best-practice section appended to an agent's system prompt. */
export const guidanceFor = (agentId: string): string => {
  const own = BY_SERVICE[agentId] ?? [];
  return `AWS best practices to steer by (teach them when relevant, one at a time):\n${[...own, ...GENERAL].map((l) => `- ${l}`).join('\n')}`;
};
