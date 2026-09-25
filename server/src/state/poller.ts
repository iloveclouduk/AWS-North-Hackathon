import { GetApisCommand } from '@aws-sdk/client-apigatewayv2';
import { DescribeTableCommand, ListTablesCommand, ListTagsOfResourceCommand } from '@aws-sdk/client-dynamodb';
import { DescribeInstancesCommand, DescribeSecurityGroupsCommand, type Tag } from '@aws-sdk/client-ec2';
import { ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { type AwsClients, classifyAwsError } from '../aws.js';
import {
  bucketPrefix,
  GAME_TAG,
  type Resource,
  type Service,
  SERVICES,
  type ServiceStatus,
  TABLE_PREFIX,
  type WorldSnapshot,
} from './model.js';

type Collector = (clients: AwsClients, accountId: string) => Promise<Resource[]>;

const tagValue = (tags: Tag[] | undefined, key: string) => tags?.find((t) => t.Key === key)?.Value;

const collectEc2: Collector = async ({ ec2 }) => {
  const resources: Resource[] = [];
  let NextToken: string | undefined;
  do {
    const page = await ec2.send(new DescribeInstancesCommand({ NextToken, MaxResults: 100 }));
    for (const i of (page.Reservations ?? []).flatMap((r) => r.Instances ?? [])) {
      if (!i.InstanceId) continue;
      resources.push({
        id: i.InstanceId,
        service: 'ec2',
        kind: 'instance',
        name: tagValue(i.Tags, 'Name') ?? i.InstanceId,
        state: i.State?.Name ?? 'unknown',
        managedByGame: tagValue(i.Tags, GAME_TAG.key) === GAME_TAG.value,
        meta: {
          instanceType: i.InstanceType ?? null,
          publicIp: i.PublicIpAddress ?? null,
          availabilityZone: i.Placement?.AvailabilityZone ?? null,
        },
      });
    }
    NextToken = page.NextToken;
  } while (NextToken);

  const groups = await ec2.send(new DescribeSecurityGroupsCommand({ MaxResults: 100 }));
  for (const g of groups.SecurityGroups ?? []) {
    if (!g.GroupId) continue;
    const inbound = g.IpPermissions ?? [];
    const openToWorld = inbound.some((p) => p.IpRanges?.some((r) => r.CidrIp === '0.0.0.0/0'));
    resources.push({
      id: g.GroupId,
      service: 'ec2',
      kind: 'security-group',
      name: g.GroupName ?? g.GroupId,
      // Encoded in state so rule changes surface as stateChanged events.
      state: `${inbound.length} inbound rule${inbound.length === 1 ? '' : 's'}`,
      managedByGame: tagValue(g.Tags, GAME_TAG.key) === GAME_TAG.value,
      meta: { vpcId: g.VpcId ?? null, openToWorld },
    });
  }
  return resources;
};

const collectDynamo: Collector = async ({ dynamodb }) => {
  const names: string[] = [];
  let ExclusiveStartTableName: string | undefined;
  do {
    const page = await dynamodb.send(new ListTablesCommand({ ExclusiveStartTableName, Limit: 100 }));
    names.push(...(page.TableNames ?? []));
    ExclusiveStartTableName = page.LastEvaluatedTableName;
  } while (ExclusiveStartTableName && names.length < 500);

  return Promise.all(
    names.map(async (name): Promise<Resource> => {
      const { Table } = await dynamodb.send(new DescribeTableCommand({ TableName: name }));
      // Ownership needs the game's tag, not just the name: someone else's "city-*" table stays read-only.
      let tagged = false;
      if (name.startsWith(TABLE_PREFIX) && Table?.TableArn) {
        const { Tags = [] } = await dynamodb.send(new ListTagsOfResourceCommand({ ResourceArn: Table.TableArn }));
        tagged = Tags.some((t) => t.Key === GAME_TAG.key && t.Value === GAME_TAG.value);
      }
      return {
        id: name,
        service: 'dynamodb',
        kind: 'table',
        name,
        state: Table?.TableStatus ?? 'unknown',
        managedByGame: tagged,
        meta: { itemCount: Table?.ItemCount ?? null, billing: Table?.BillingModeSummary?.BillingMode ?? null },
      };
    }),
  );
};

const collectS3: Collector = async ({ s3 }, accountId) => {
  const { Buckets = [] } = await s3.send(new ListBucketsCommand({}));
  return Buckets.filter((b) => b.Name).map((b) => ({
    id: b.Name!,
    service: 's3' as const,
    kind: 'bucket' as const,
    name: b.Name!,
    state: 'active',
    managedByGame: b.Name!.startsWith(bucketPrefix(accountId)),
    meta: { createdAt: b.CreationDate?.toISOString() ?? null },
  }));
};

const collectLambda: Collector = async ({ lambda }) => {
  const { Functions = [] } = await lambda.send(new ListFunctionsCommand({ MaxItems: 50 }));
  return Functions.filter((f) => f.FunctionName).map((f) => ({
    id: f.FunctionName!,
    service: 'lambda' as const,
    kind: 'function' as const,
    name: f.FunctionName!,
    state: f.State ?? 'Active',
    managedByGame: false,
    meta: { runtime: f.Runtime ?? null },
  }));
};

const collectRds: Collector = async ({ rds }) => {
  const { DBInstances = [] } = await rds.send(new DescribeDBInstancesCommand({ MaxRecords: 50 }));
  return DBInstances.filter((d) => d.DBInstanceIdentifier).map((d) => ({
    id: d.DBInstanceIdentifier!,
    service: 'rds' as const,
    kind: 'db-instance' as const,
    name: d.DBInstanceIdentifier!,
    state: d.DBInstanceStatus ?? 'unknown',
    managedByGame: false,
    meta: { engine: d.Engine ?? null, instanceClass: d.DBInstanceClass ?? null },
  }));
};

const collectApis: Collector = async ({ apigw }) => {
  const { Items = [] } = await apigw.send(new GetApisCommand({ MaxResults: '50' }));
  return Items.filter((a) => a.ApiId).map((a) => ({
    id: a.ApiId!,
    service: 'apigateway' as const,
    kind: 'api' as const,
    name: a.Name ?? a.ApiId!,
    state: 'active',
    managedByGame: false,
    meta: { protocol: a.ProtocolType ?? null, endpoint: a.ApiEndpoint ?? null },
  }));
};

const COLLECTORS: Record<Service, Collector> = {
  ec2: collectEc2,
  dynamodb: collectDynamo,
  s3: collectS3,
  lambda: collectLambda,
  rds: collectRds,
  apigateway: collectApis,
};

export interface Poller {
  current(): WorldSnapshot | null;
  /** Poll now (coalesced with any poll already in flight). */
  refresh(): Promise<WorldSnapshot>;
  start(): void;
  stop(): void;
}

export const createPoller = (opts: {
  clients: AwsClients;
  accountId: string;
  region: string;
  intervalMs: number;
  onSnapshot: (prev: WorldSnapshot | null, next: WorldSnapshot) => void;
}): Poller => {
  let snapshot: WorldSnapshot | null = null;
  let inFlight: Promise<WorldSnapshot> | null = null;
  let timer: NodeJS.Timeout | undefined;

  const pollOnce = async (): Promise<WorldSnapshot> => {
    const results = await Promise.all(
      SERVICES.map(async (service) => {
        try {
          return { service, status: 'ok' as ServiceStatus, resources: await COLLECTORS[service](opts.clients, opts.accountId), expired: false };
        } catch (err) {
          const kind = classifyAwsError(err);
          if (kind === 'other') console.warn(`[poller] ${service}:`, (err as Error).message);
          // Keep the last known resources on transient errors so buildings don't flicker away.
          const kept = kind === 'denied' ? [] : (snapshot?.resources.filter((r) => r.service === service) ?? []);
          return { service, status: (kind === 'denied' ? 'locked' : 'error') as ServiceStatus, resources: kept, expired: kind === 'expired' };
        }
      }),
    );

    const next: WorldSnapshot = {
      takenAt: new Date().toISOString(),
      region: opts.region,
      accountId: opts.accountId,
      credentials: results.some((r) => r.expired) ? 'expired' : 'ok',
      services: Object.fromEntries(results.map((r) => [r.service, r.status])) as Record<Service, ServiceStatus>,
      resources: results.flatMap((r) => r.resources),
    };
    const prev = snapshot;
    snapshot = next;
    opts.onSnapshot(prev, next);
    return next;
  };

  const refresh = () => {
    inFlight ??= pollOnce().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    current: () => snapshot,
    refresh,
    start() {
      void refresh();
      timer = setInterval(() => void refresh().catch((e) => console.error('[poller]', e)), opts.intervalMs);
    },
    stop() {
      clearInterval(timer);
    },
  };
};
