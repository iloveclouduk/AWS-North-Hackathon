import { DescribeAvailabilityZonesCommand, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import { ListIndexesCommand, SearchCommand } from '@aws-sdk/client-resource-explorer-2';
import { GetResourcesCommand } from '@aws-sdk/client-resource-groups-tagging-api';
import arnServices from '../../../shared/arn-services.json' with { type: 'json' };
import { type AwsClients, classifyAwsError } from '../aws.js';
import { log } from '../log.js';
import { serviceById, type AzInfo, type CityInventoryEvent, type DataLink, type InventoryItem } from '../world.js';
import { GAME_TAG, type WorldSnapshot } from './model.js';

/** The city mirrors a learner's account, not a fleet: the listing stops here. */
export const MAX_ITEMS = 1000;
/** Items per city.inventory frame (the rest are counted, not listed), so a frame stays well under 64 KB. */
export const ITEMS_PER_EVENT = 300;

const MAP = arnServices.map as Record<string, string>;

/** arn:partition:service:region:account:resource → the landmark it belongs to, or null (a "?" lot). */
export const serviceForArn = (arn: string): { serviceId: string | null; type: string; name: string } => {
  const [, , service = '', , , ...rest] = arn.split(':');
  const resource = rest.join(':');
  const type = resource.split(/[:/]/)[0] ?? '';
  const name = resource.split(/[:/]/).filter(Boolean).at(-1) ?? resource;
  const serviceId = MAP[`${service}:${type}`] ?? MAP[service] ?? null;
  return { serviceId: serviceId && serviceById(serviceId) ? serviceId : null, type: type ? `${service}:${type}` : service, name };
};

/** The Region in an ARN (empty for global services like IAM or S3 bucket ARNs). */
export const regionOfArn = (arn: string) => arn.split(':')[3] ?? '';

const item = (arn: string, managedByGame: boolean, region?: string): InventoryItem => {
  const { serviceId, type, name } = serviceForArn(arn);
  const r = region || regionOfArn(arn);
  return { arn, type, name, serviceId, districtId: serviceId ? (serviceById(serviceId)?.districtId ?? null) : null, managedByGame, ...(r ? { region: r } : {}) };
};

export interface Inventory {
  source: CityInventoryEvent['source'];
  complete: boolean;
  items: InventoryItem[];
  /** Whether the list spans every Region (an aggregator index in the home Region) or only the home Region. */
  allRegions?: boolean;
}

/**
 * Everything in the account, in this Region, read-only:
 * 1. Resource Explorer, when the account has an index here: every resource, tagged or not.
 * 2. Otherwise the tagging API, which only lists resources that have (or had) tags, so the result isn't complete.
 * Cloud Control isn't used: its IAM actions are cloudformation:*, which the workshop account denies.
 */
export const readInventory = async (clients: AwsClients, region: string): Promise<Inventory | undefined> => {
  try {
    const { Indexes = [] } = await clients.explorer.send(new ListIndexesCommand({ Regions: [region] }));
    if (Indexes.length) {
      // An aggregator index here sees every Region: an empty query lists all of it (through the default view).
      const allRegions = Indexes.some((i) => i.Type === 'AGGREGATOR');
      const items: InventoryItem[] = [];
      let NextToken: string | undefined;
      do {
        const page = await clients.explorer.send(new SearchCommand({ QueryString: allRegions ? '' : `region:${region}`, MaxResults: 1000, NextToken }));
        for (const r of page.Resources ?? []) if (r.Arn) items.push(item(r.Arn, false, r.Region));
        NextToken = page.NextToken;
      } while (NextToken && items.length < MAX_ITEMS);
      return { source: 'resource-explorer', complete: !NextToken, items: items.slice(0, MAX_ITEMS), allRegions };
    }
  } catch (err) {
    // No index, no default view or no permission: fall back to the tagging API.
    if (classifyAwsError(err) === 'other') log.warn('resource explorer unavailable', { err: (err as Error).name });
  }
  try {
    const items: InventoryItem[] = [];
    let PaginationToken: string | undefined;
    do {
      const page = await clients.tagging.send(new GetResourcesCommand({ PaginationToken, ResourcesPerPage: 100 }));
      for (const r of page.ResourceTagMappingList ?? []) {
        if (r.ResourceARN) items.push(item(r.ResourceARN, !!r.Tags?.some((t) => t.Key === GAME_TAG.key && t.Value === GAME_TAG.value)));
      }
      PaginationToken = page.PaginationToken || undefined;
    } while (PaginationToken && items.length < MAX_ITEMS);
    return { source: 'tagging', complete: false, items: items.slice(0, MAX_ITEMS) };
  } catch (err) {
    log.warn('inventory unavailable', { err: (err as Error).name });
    return undefined;
  }
};

/**
 * Zonal placement and data links from the poller's snapshot: instance and DB AZs, DynamoDB global table replicas
 * (Region to Region) and RDS Multi-AZ standbys (AZ to AZ).
 */
export const enrich = (inv: Inventory, snapshot: WorldSnapshot | undefined, region: string): { items: InventoryItem[]; links: DataLink[] } => {
  if (!snapshot) return { items: inv.items, links: [] };
  const azByArnTail = new Map<string, string>();
  for (const r of snapshot.resources) {
    const az = r.meta.availabilityZone;
    if (typeof az === 'string' && az) azByArnTail.set(r.id, az);
  }
  const items = inv.items.map((i) => {
    const az = azByArnTail.get(i.name);
    return az && (i.region ?? region) === region ? { ...i, az } : i;
  });
  const links: DataLink[] = [];
  for (const r of snapshot.resources) {
    if (r.kind === 'table' && typeof r.meta.replicas === 'string') {
      for (const other of r.meta.replicas.split(',').filter((x) => x && x !== region)) {
        links.push({ id: `ddb:${r.id}:${other}`, serviceId: 'dynamodb', from: { region }, to: { region: other }, kind: 'replication', twoWay: true, label: `Global table ${r.name}` });
      }
    }
    if (r.kind === 'db-instance' && r.meta.multiAz === true && typeof r.meta.availabilityZone === 'string' && typeof r.meta.secondaryAz === 'string') {
      links.push({ id: `rds:${r.id}`, serviceId: 'rds', from: { region, az: r.meta.availabilityZone }, to: { region, az: r.meta.secondaryAz }, kind: 'standby', label: `Multi-AZ standby for ${r.name}` });
    }
  }
  return { items, links };
};

// ── v2.5: the account's real map: AZ name → AZ ID per Region, and which Regions are turned on ──

/** AZ maps and Region opt-ins rarely change: read each once a day. */
export const GEO_TTL_MS = 24 * 60 * 60_000;
/** A Region we couldn't read (no permission, not opted in) is tried again after an hour, not every refresh. */
export const GEO_RETRY_MS = 60 * 60_000;
/** A learner's account, not a fleet: AZ maps for at most this many Regions per refresh. */
export const MAX_ZONE_REGIONS = 40;

type Cached<T> = { value: T | undefined; at: number; ttl: number };
const geoCache = new WeakMap<AwsClients, Map<string, Cached<unknown>>>();

/** A cached read: a failure is remembered as "unknown" (left out) for GEO_RETRY_MS and never thrown. */
const cachedGeo = async <T>(clients: AwsClients, key: string, read: () => Promise<T>, now: number): Promise<T | undefined> => {
  let cache = geoCache.get(clients);
  if (!cache) geoCache.set(clients, (cache = new Map()));
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && now - hit.at < hit.ttl) return hit.value;
  try {
    const value = await read();
    cache.set(key, { value, at: now, ttl: GEO_TTL_MS });
    return value;
  } catch (err) {
    // AccessDenied / UnauthorizedOperation (an older player role), OptInRequired or AuthFailure (a Region that isn't
    // turned on): the city just doesn't draw that Region's real AZs. Nothing breaks.
    if (classifyAwsError(err) === 'other') log.warn('zone read failed', { key, err: (err as Error).name });
    cache.set(key, { value: undefined, at: now, ttl: GEO_RETRY_MS });
    return undefined;
  }
};

/** One Region's Availability Zones (not Local or Wavelength Zones), sorted by name. */
export const readZones = (clients: AwsClients, region: string, now = Date.now()): Promise<AzInfo[] | undefined> =>
  cachedGeo(
    clients,
    `zones:${region}`,
    async () => {
      const { AvailabilityZones = [] } = await clients.ec2For(region).send(new DescribeAvailabilityZonesCommand({ Filters: [{ Name: 'zone-type', Values: ['availability-zone'] }] }));
      return AvailabilityZones.filter((z) => z.ZoneName && z.ZoneId && (z.ZoneType ?? 'availability-zone') === 'availability-zone')
        .map((z) => ({ name: z.ZoneName!, id: z.ZoneId! }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    now,
  );

/** Every Region the account knows about, and whether it's turned on (from the home Region). */
export const readRegionStatus = (clients: AwsClients, now = Date.now()): Promise<CityInventoryEvent['regionStatus']> =>
  cachedGeo(
    clients,
    'regions',
    async () => {
      const { Regions = [] } = await clients.ec2.send(new DescribeRegionsCommand({ AllRegions: true }));
      const out: NonNullable<CityInventoryEvent['regionStatus']> = {};
      for (const r of Regions) {
        if (!r.RegionName) continue;
        out[r.RegionName] = r.OptInStatus === 'not-opted-in' ? 'not-enabled' : 'enabled';
      }
      return out;
    },
    now,
  );

/** The AZ maps for the home Region and every Region with items, plus the Regions' status. Never throws. */
export const readGeo = async (clients: AwsClients, home: string, items: InventoryItem[], now = Date.now()): Promise<Pick<CityInventoryEvent, 'zones' | 'regionStatus'>> => {
  const wanted = [home, ...new Set(items.map((i) => i.region).filter((r): r is string => !!r && r !== 'global' && r !== home))].slice(0, MAX_ZONE_REGIONS);
  const [regionStatus, ...maps] = await Promise.all([readRegionStatus(clients, now), ...wanted.map((r) => readZones(clients, r, now))]);
  const zones: Record<string, AzInfo[]> = {};
  wanted.forEach((r, i) => {
    const m = maps[i];
    if (m?.length) zones[r] = m;
  });
  return { ...(Object.keys(zones).length ? { zones } : {}), ...(regionStatus && Object.keys(regionStatus).length ? { regionStatus } : {}) };
};

/** The city.inventory event for an inventory: counts for everything, items up to one frame's worth. */
export const inventoryEvent = (
  inv: Inventory,
  region: string,
  takenAt = new Date().toISOString(),
  links: DataLink[] = [],
  geo: Pick<CityInventoryEvent, 'zones' | 'regionStatus'> = {},
): CityInventoryEvent => {
  const counts: Record<string, number> = {};
  const regions: Record<string, number> = {};
  for (const i of inv.items) {
    // The city's own counts are for its home Region (and global resources); other Regions are their own cities.
    const r = i.region || region;
    regions[r] = (regions[r] ?? 0) + 1;
    if (r === region || r === 'global') counts[i.serviceId ?? 'other'] = (counts[i.serviceId ?? 'other'] ?? 0) + 1;
  }
  return {
    type: 'city.inventory',
    takenAt,
    region,
    source: inv.source,
    complete: inv.complete,
    counts,
    items: inv.items.slice(0, ITEMS_PER_EVENT),
    truncated: inv.items.length > ITEMS_PER_EVENT,
    homeRegion: region,
    regions,
    links,
    ...geo,
  };
};
