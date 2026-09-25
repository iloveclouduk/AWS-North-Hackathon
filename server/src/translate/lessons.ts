import type { ResourceKind, Service } from '../state/model.js';

/** One-line, beginner-friendly explanation per resource kind: the "what am I looking at" lesson. */
export const KIND_LESSONS: Record<ResourceKind, string> = {
  instance:
    'An EC2 instance is a virtual computer you rent by the second. Stopped instances cost nothing for compute, but their disks still cost a little.',
  'security-group':
    'A security group is a firewall for your instances. Inbound rules decide who can connect; everything else is blocked by default.',
  table:
    'A DynamoDB table stores items by key. On-demand billing means you pay per request, with no servers to manage.',
  bucket: 'An S3 bucket stores files ("objects"). Bucket names are global across all of AWS, so they must be unique.',
  function: 'A Lambda function runs your code only when something triggers it. You pay per run, not per hour.',
  'db-instance': 'An RDS instance is a managed relational database (like PostgreSQL or MySQL). AWS handles patching and backups.',
  api: 'API Gateway gives your backend a public HTTPS front door and routes each request to the right service.',
};

export const STATE_LESSONS: Record<string, string> = {
  pending: 'Pending means AWS is finding hardware and booting your instance. It usually takes under a minute.',
  running: 'Running means the instance is on and billing by the second.',
  stopping: 'Stopping is like shutting down a laptop. The disk (EBS volume) is kept.',
  stopped: 'Stopped instances keep their disk but release their CPU and memory. The public IP usually changes when you start again.',
  'shutting-down': 'Shutting down means the instance is being terminated for good.',
  terminated: 'Terminated instances are gone permanently, and their root disk is deleted with them.',
  ACTIVE: 'ACTIVE means the table is ready for reads and writes.',
  CREATING: 'CREATING means DynamoDB is provisioning the table. Writes will fail until it becomes ACTIVE.',
  DELETING: 'DELETING means the table and all of its items are being removed.',
};

export const LOCKED_LESSON = (service: Service) =>
  `This district is locked: your IAM role isn't allowed to read ${service}. In AWS, every API call is checked against IAM policies. No permission means "AccessDenied".`;

export const EXPIRED_LESSON =
  'Your temporary AWS credentials have expired. Session keys (the ones starting with ASIA) only last a few hours. Refresh them to keep playing.';
