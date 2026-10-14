export const SERVICES = ['ec2', 'dynamodb', 's3', 'lambda', 'rds', 'apigateway'] as const;
export type Service = (typeof SERVICES)[number];

export type ResourceKind = 'instance' | 'security-group' | 'table' | 'bucket' | 'function' | 'db-instance' | 'api';

export interface Resource {
  id: string;
  service: Service;
  kind: ResourceKind;
  name: string;
  state: string;
  /** Created by this game (tag managed-by=aws-city or the game's name prefix); only these can be changed. */
  managedByGame: boolean;
  meta: Record<string, string | number | boolean | null>;
}

/** ok = readable; locked = IAM denies reading it; error = transient failure (last known resources are kept). */
export type ServiceStatus = 'ok' | 'locked' | 'error';

/** Account- or Region-wide settings the checks need. A missing field means "couldn't read it" (no finding). */
export interface AccountSettings {
  /** EBS encryption by default, in this Region. */
  ebsEncryptionByDefault?: boolean;
  /**
   * Account-level S3 Block Public Access as four flags, '1' = on, in the order BlockPublicAcls, IgnorePublicAcls,
   * BlockPublicPolicy, RestrictPublicBuckets (S3 applies the most restrictive mix of account and bucket, setting by setting).
   */
  s3AccountBpa?: string;
  /** Trails logging this Region, plus CloudTrail Lake event data stores (0 = nothing keeps the record past 90 days). */
  trails?: number;
  /** EBS volumes not attached to any instance (status "available"), at most 50. */
  unattachedVolumes?: { id: string; name: string; sizeGiB: number }[];
}

export interface WorldSnapshot {
  takenAt: string;
  region: string;
  accountId: string;
  credentials: 'ok' | 'expired';
  services: Record<Service, ServiceStatus>;
  resources: Resource[];
  account?: AccountSettings;
}

export type AwsEvent =
  | { type: 'created'; resource: Resource }
  | { type: 'deleted'; resource: Resource }
  | { type: 'stateChanged'; resource: Resource; from: string; to: string }
  | { type: 'serviceLocked'; service: Service }
  | { type: 'serviceUnlocked'; service: Service }
  | { type: 'credentialsExpired' }
  | { type: 'credentialsRestored' };

export const GAME_TAG = { key: 'managed-by', value: 'aws-city' } as const;
export const TABLE_PREFIX = 'city-';
export const bucketPrefix = (accountId: string) => `aws-city-${accountId}-`;

export const resourceKey = (r: Pick<Resource, 'kind' | 'id'>) => `${r.kind}:${r.id}`;
