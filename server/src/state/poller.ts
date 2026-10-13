import { GetApisCommand } from '@aws-sdk/client-apigatewayv2';
import { DescribeTrailsCommand, GetTrailStatusCommand, ListEventDataStoresCommand } from '@aws-sdk/client-cloudtrail';
import { DescribeContinuousBackupsCommand, DescribeTableCommand, ListTablesCommand, ListTagsOfResourceCommand } from '@aws-sdk/client-dynamodb';
import { DescribeInstancesCommand, DescribeSecurityGroupsCommand, DescribeVolumesCommand, GetEbsEncryptionByDefaultCommand, type IpPermission, type Tag } from '@aws-sdk/client-ec2';
import { ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { GetPublicAccessBlockCommand, ListBucketsCommand, type PublicAccessBlockConfiguration } from '@aws-sdk/client-s3';
import { GetPublicAccessBlockCommand as GetAccountPublicAccessBlockCommand } from '@aws-sdk/client-s3-control';
import { type AwsClients, classifyAwsError } from '../aws.js';
import {
  type AccountSettings,
  bucketPrefix,
  GAME_TAG,
  type Resource,
  type Service,
  SERVICES,
  type ServiceStatus,
  TABLE_PREFIX,
  type WorldSnapshot,
} from './model.js';
import { log } from '../log.js';

type Collector = (clients: AwsClients, accountId: string) => Promise<Resource[]>;

const tagValue = (tags: Tag[] | undefined, key: string) => tags?.find((t) => t.Key === key)?.Value;

/** Listings stop here: the city shows a learner's account, not a fleet (and every poll stays cheap). */
const MAX_PER_SERVICE = 200;
/** At most this many per-table calls in flight: DescribeTable/ListTagsOfResource have low per-account rates. */
const TABLE_CONCURRENCY = 5;
/**
 * Table tags rarely change: a "tagged" answer is reused for a few minutes instead of re-read every 10 s.
 * "Untagged" is never cached, so a table the game just created (tags still propagating) is seen as soon as they land.
 */
const TAG_TTL_MS = 5 * 60_000;

/** Like Promise.all over items, but with at most `limit` running at once. */
export const mapLimit = async <T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

/** Pages through a listing until it ends or MAX_PER_SERVICE items are collected. */
const paginate = async <I>(fetch: (token: string | undefined) => Promise<{ items: I[]; next?: string }>): Promise<I[]> => {
  const all: I[] = [];
  let token: string | undefined;
  do {
    const page = await fetch(token);
    all.push(...page.items);
    token = page.next;
  } while (token && all.length < MAX_PER_SERVICE);
  return all.slice(0, MAX_PER_SERVICE);
};

/** Per AWS account (clients object): table ARN → whether it carries the game tag, and when that was read. */
const tagCache = new WeakMap<AwsClients, Map<string, { tagged: boolean; at: number }>>();

/** Settings the Well-Architected checks read (PITR, Block Public Access, account settings) change rarely: re-read every few minutes. */
const SETTING_TTL_MS = 5 * 60_000;
const settingCache = new WeakMap<AwsClients, Map<string, { value: unknown; at: number }>>();
/**
 * Cached read; a failure (no permission, throttled) gives undefined, which means "unknown": no finding is raised.
 * Failures are cached too (as unknown, for the same TTL): a role from an older template that can't read a setting would
 * otherwise be denied once per table/bucket on every 10 s poll. Expired credentials aren't cached (the next poll has fresh ones).
 */
const setting = async <T>(clients: AwsClients, key: string, read: () => Promise<T>): Promise<T | undefined> => {
  const cache = settingCache.get(clients) ?? new Map<string, { value: unknown; at: number }>();
  settingCache.set(clients, cache);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < SETTING_TTL_MS) return hit.value as T | undefined;
  try {
    const value = await read();
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch (err) {
    const kind = classifyAwsError(err);
    if (kind === 'other') log.warn('setting read failed', { key: key.split(':')[0], err: (err as Error).name });
    if (kind !== 'expired') cache.set(key, { value: undefined, at: Date.now() });
    return undefined;
  }
};

const ADMIN_PORTS = [22, 3389];
const WORLD = (p: IpPermission) => p.IpRanges?.some((r) => r.CidrIp === '0.0.0.0/0') || p.Ipv6Ranges?.some((r) => r.CidrIpv6 === '::/0');
/** An inbound rule that lets anyone on the internet reach SSH (22) or RDP (3389). */
export const opensAdminToWorld = (p: IpPermission) =>
  !!WORLD(p) && (p.IpProtocol === '-1' || (p.IpProtocol === 'tcp' && ADMIN_PORTS.some((port) => (p.FromPort ?? 0) <= port && port <= (p.ToPort ?? 65535))));

/** Drop a cached setting (after a fix changed it), so the next poll reads it fresh. */
export const forgetSetting = (clients: AwsClients, key: string) => void settingCache.get(clients)?.delete(key);

/** The four Block Public Access settings as '1'/'0' flags (no configuration = all off). */
export const bpaFlags = (c?: PublicAccessBlockConfiguration) => [c?.BlockPublicAcls, c?.IgnorePublicAcls, c?.BlockPublicPolicy, c?.RestrictPublicBuckets].map((on) => (on ? '1' : '0')).join('');

const collectEc2: Collector = async ({ ec2 }) => {
  const resources: Resource[] = [];
  // Instances stop at MAX_PER_SERVICE like every other listing (paging stops there too; the rest aren't shown).
  let NextToken: string | undefined;
  do {
    const page = await ec2.send(new DescribeInstancesCommand({ NextToken, MaxResults: 100 }));
    for (const i of (page.Reservations ?? []).flatMap((r) => r.Instances ?? [])) {
      if (!i.InstanceId || resources.length >= MAX_PER_SERVICE) continue;
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
          // "optional" = IMDSv1 still answers; "required" = IMDSv2 only. A disabled endpoint answers neither.
          httpTokens: i.MetadataOptions?.HttpTokens ?? null,
          httpEndpoint: i.MetadataOptions?.HttpEndpoint ?? null,
        },
      });
    }
    NextToken = page.NextToken;
  } while (NextToken && resources.length < MAX_PER_SERVICE);

  const groups = await paginate(async (NextToken) => {
    const page = await ec2.send(new DescribeSecurityGroupsCommand({ NextToken, MaxResults: 100 }));
    return { items: page.SecurityGroups ?? [], next: page.NextToken };
  });
  for (const g of groups) {
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
      meta: { vpcId: g.VpcId ?? null, openToWorld, adminOpenToWorld: inbound.some(opensAdminToWorld) },
    });
  }
  return resources;
};

const collectDynamo: Collector = async (clients) => {
  const { dynamodb } = clients;
  const tags = tagCache.get(clients) ?? new Map<string, { tagged: boolean; at: number }>();
  tagCache.set(clients, tags);
  const names: string[] = [];
  let ExclusiveStartTableName: string | undefined;
  do {
    const page = await dynamodb.send(new ListTablesCommand({ ExclusiveStartTableName, Limit: 100 }));
    names.push(...(page.TableNames ?? []));
    ExclusiveStartTableName = page.LastEvaluatedTableName;
  } while (ExclusiveStartTableName && names.length < 500);
  // Names are cheap (100 a call); DescribeTable is one call per table per poll. Only MAX_PER_SERVICE tables are described,
  // the game's own (city-*) first so a crowded account never hides them; the rest aren't shown.
  const described = [...names.filter((n) => n.startsWith(TABLE_PREFIX)), ...names.filter((n) => !n.startsWith(TABLE_PREFIX))].slice(0, MAX_PER_SERVICE);

  return mapLimit(described, TABLE_CONCURRENCY, async (name): Promise<Resource> => {
    const { Table } = await dynamodb.send(new DescribeTableCommand({ TableName: name }));
    // Ownership needs the game's tag, not just the name: someone else's "city-*" table stays read-only.
    let tagged = false;
    if (name.startsWith(TABLE_PREFIX) && Table?.TableArn) {
      const hit = tags.get(Table.TableArn);
      if (hit && Date.now() - hit.at < TAG_TTL_MS) tagged = hit.tagged;
      else {
        const { Tags = [] } = await dynamodb.send(new ListTagsOfResourceCommand({ ResourceArn: Table.TableArn }));
        tagged = Tags.some((t) => t.Key === GAME_TAG.key && t.Value === GAME_TAG.value);
        if (tagged) tags.set(Table.TableArn, { tagged, at: Date.now() });
      }
    }
    const pitr = await setting(clients, `pitr:${name}`, async () => {
      const { ContinuousBackupsDescription: d } = await dynamodb.send(new DescribeContinuousBackupsCommand({ TableName: name }));
      return d?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus === 'ENABLED';
    });
    return {
      id: name,
      service: 'dynamodb',
      kind: 'table',
      name,
      state: Table?.TableStatus ?? 'unknown',
      managedByGame: tagged,
      meta: {
        itemCount: Table?.ItemCount ?? null,
        billing: Table?.BillingModeSummary?.BillingMode ?? null,
        pitr: pitr ?? null,
        arn: Table?.TableArn ?? null,
        // Global table replicas in other Regions (comma-separated Region codes), for the world map's data links.
        replicas: (Table?.Replicas ?? []).map((r) => r.RegionName).filter(Boolean).join(',') || null,
      },
    };
  });
};

const collectS3: Collector = async (clients, accountId) => {
  const { s3 } = clients;
  const { Buckets = [] } = await s3.send(new ListBucketsCommand({ MaxBuckets: MAX_PER_SERVICE }));
  const region = await s3.config.region();
  return mapLimit(
    Buckets.filter((b) => b.Name),
    TABLE_CONCURRENCY,
    async (b): Promise<Resource> => {
      // Only this Region's buckets are checked (a bucket's settings are read from its own Region).
      const local = !b.BucketRegion || b.BucketRegion === region;
      const bpa = local
        ? await setting(clients, `bpa:${b.Name}`, async () => {
            try {
              return bpaFlags((await s3.send(new GetPublicAccessBlockCommand({ Bucket: b.Name! }))).PublicAccessBlockConfiguration);
            } catch (err) {
              if ((err as Error).name === 'NoSuchPublicAccessBlockConfiguration') return bpaFlags();
              throw err;
            }
          })
        : undefined;
      return {
        id: b.Name!,
        service: 's3',
        kind: 'bucket',
        name: b.Name!,
        state: 'active',
        managedByGame: b.Name!.startsWith(bucketPrefix(accountId)),
        meta: { createdAt: b.CreationDate?.toISOString() ?? null, bucketRegion: b.BucketRegion ?? null, bpa: bpa ?? null },
      };
    },
  );
};

const collectLambda: Collector = async ({ lambda }) => {
  const Functions = await paginate(async (Marker) => {
    const page = await lambda.send(new ListFunctionsCommand({ Marker, MaxItems: 50 }));
    return { items: page.Functions ?? [], next: page.NextMarker };
  });
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
  const DBInstances = await paginate(async (Marker) => {
    const page = await rds.send(new DescribeDBInstancesCommand({ Marker, MaxRecords: 50 }));
    return { items: page.DBInstances ?? [], next: page.Marker };
  });
  return DBInstances.filter((d) => d.DBInstanceIdentifier).map((d) => ({
    id: d.DBInstanceIdentifier!,
    service: 'rds' as const,
    kind: 'db-instance' as const,
    name: d.DBInstanceIdentifier!,
    state: d.DBInstanceStatus ?? 'unknown',
    managedByGame: false,
    // Aurora instances always report MultiAZ=false (the cluster manages their AZs), so it's unknown for them.
    meta: {
      engine: d.Engine ?? null,
      instanceClass: d.DBInstanceClass ?? null,
      public: d.PubliclyAccessible ?? null,
      multiAz: d.DBClusterIdentifier ? null : (d.MultiAZ ?? null),
      availabilityZone: d.AvailabilityZone ?? null,
      // The Multi-AZ standby's AZ, for the city's AZ bridges.
      secondaryAz: d.SecondaryAvailabilityZone ?? null,
      arn: d.DBInstanceArn ?? null,
    },
  }));
};

const collectApis: Collector = async ({ apigw }) => {
  const Items = await paginate(async (NextToken) => {
    const page = await apigw.send(new GetApisCommand({ NextToken, MaxResults: '50' }));
    return { items: page.Items ?? [], next: page.NextToken };
  });
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

/** Account- and Region-wide settings (each one unknown if it can't be read). */
const collectAccount = async (clients: AwsClients, accountId: string): Promise<AccountSettings> => {
  const [ebsEncryptionByDefault, s3AccountBpa, trails, unattachedVolumes] = await Promise.all([
    setting(clients, 'ebs-default', async () => (await clients.ec2.send(new GetEbsEncryptionByDefaultCommand({}))).EbsEncryptionByDefault ?? false),
    setting(clients, 's3-account-bpa', async () => {
      try {
        return bpaFlags((await clients.s3control.send(new GetAccountPublicAccessBlockCommand({ AccountId: accountId }))).PublicAccessBlockConfiguration);
      } catch (err) {
        if ((err as Error).name === 'NoSuchPublicAccessBlockConfiguration') return bpaFlags();
        throw err;
      }
    }),
    // Trails that are actually logging (shadow trails included: an organization or multi-Region trail from elsewhere still
    // records this Region), plus CloudTrail Lake event data stores, which keep the record too.
    setting(clients, 'trails', async () => {
      const { trailList = [] } = await clients.cloudtrail.send(new DescribeTrailsCommand({ includeShadowTrails: true }));
      const logging = await mapLimit(trailList.slice(0, 10), 3, async (tr) => {
        try {
          return (await clients.cloudtrail.send(new GetTrailStatusCommand({ Name: tr.TrailARN ?? tr.Name! }))).IsLogging ? 1 : 0;
        } catch {
          return 1; // a shadow trail's status may only be readable from its home Region: count it rather than cry wolf
        }
      });
      const { EventDataStores = [] } = await clients.cloudtrail.send(new ListEventDataStoresCommand({ MaxResults: 10 })).catch(() => ({ EventDataStores: [] }));
      return logging.reduce<number>((a, b) => a + b, 0) + EventDataStores.filter((s) => s.Status === 'ENABLED' || s.Status === undefined).length;
    }),
    setting(clients, 'unattached-volumes', async () => {
      const { Volumes = [] } = await clients.ec2.send(new DescribeVolumesCommand({ Filters: [{ Name: 'status', Values: ['available'] }], MaxResults: 50 }));
      return Volumes.filter((v) => v.VolumeId).map((v) => ({ id: v.VolumeId!, name: tagValue(v.Tags, 'Name') ?? v.VolumeId!, sizeGiB: v.Size ?? 0 }));
    }),
  ]);
  return { ebsEncryptionByDefault, s3AccountBpa, trails, unattachedVolumes };
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
    const accountSettings = collectAccount(opts.clients, opts.accountId);
    const results = await Promise.all(
      SERVICES.map(async (service) => {
        try {
          return { service, status: 'ok' as ServiceStatus, resources: await COLLECTORS[service](opts.clients, opts.accountId), expired: false };
        } catch (err) {
          const kind = classifyAwsError(err);
          if (kind === 'other') log.warn('poll failed', { service, err: (err as Error).name, detail: (err as Error).message?.slice(0, 200) });
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
      account: await accountSettings,
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
      const tick = () => void refresh().catch((e) => log.error('poll failed', { err: (e as Error).name, detail: (e as Error).message?.slice(0, 200) }));
      tick();
      timer = setInterval(tick, opts.intervalMs);
    },
    stop() {
      clearInterval(timer);
    },
  };
};
