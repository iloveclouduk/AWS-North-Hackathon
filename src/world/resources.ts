// Your real resources, one by one, where they really live: a server on its Availability Zone's island, a bucket on S3
// Lake, a function at the Lambda stall. Pure (the scene draws what this decides), and data-driven
// (shared/resource-props.json, by CloudFormation type), so no service id is hard-coded here.

import propsJson from '../../shared/resource-props.json' with { type: 'json' };
import type { InventoryItem } from '@/backend/contract';
import { isGlobalService, zoneIndex, type Zone } from './regions';

export type PropKind = 'house' | 'vault' | 'locker' | 'boat' | 'cart' | 'cabinet' | 'mailbox' | 'crate' | 'barrel' | 'kiosk' | 'badge' | 'sign' | 'fence';
export interface PropInfo {
  prop: PropKind;
  /** What a player calls one ("server", "bucket"). */
  noun: string;
  /** Lives in one Availability Zone. */
  zonal?: boolean;
}
export const PROPS = (propsJson as unknown as { props: Record<string, PropInfo> }).props;

/** At most this many props stand on one island or by one landmark; the rest are "+N". */
export const ZONE_CAP = 6;
export const LANDMARK_CAP = 4;

export interface Placed {
  item: InventoryItem;
  info: PropInfo;
}
export interface Group {
  shown: Placed[];
  /** How many more there are (drawn as "+N"). */
  more: number;
}
export interface Placement {
  /** One group per island, in island order. */
  zones: Group[];
  /** By the service's landmark. */
  landmarks: Record<string, Group>;
  /** Kinds the city has no prop for, by district (null = no district): one shed each. */
  sheds: Record<string, InventoryItem[]>;
}

const group = (all: Placed[], cap: number): Group => ({ shown: all.slice(0, cap), more: Math.max(0, all.length - cap) });

/** Whether an item belongs to this Region's city. Global services stand in every city; other global ARNs (S3 buckets) in the home Region's. */
export function inCity(it: InventoryItem, region: string, home: string | undefined): boolean {
  if (it.serviceId && isGlobalService(it.serviceId)) return true;
  const r = it.region === 'global' || !it.region ? (home ?? region) : it.region;
  return r === region;
}

/** Where every item of this Region's city goes. */
export function placeResources(items: InventoryItem[], islands: Zone[], region: string, home?: string): Placement {
  const zones: Placed[][] = islands.map(() => []);
  const byLandmark: Record<string, Placed[]> = {};
  const sheds: Record<string, InventoryItem[]> = {};
  for (const item of items) {
    if (!inCity(item, region, home)) continue;
    const info = PROPS[item.type];
    if (!info || !item.serviceId) {
      (sheds[item.districtId ?? 'none'] ??= []).push(item);
      continue;
    }
    const z = info.zonal && item.az ? zoneIndex(islands, item.az) : undefined;
    if (z !== undefined) zones[z]!.push({ item, info });
    else (byLandmark[item.serviceId] ??= []).push({ item, info });
  }
  return {
    zones: zones.map((z) => group(z, ZONE_CAP)),
    landmarks: Object.fromEntries(Object.entries(byLandmark).map(([id, l]) => [id, group(l, LANDMARK_CAP)])),
    sheds,
  };
}

/** What a prop says when tapped: "Your server web-1, in Zone B." */
export function propLine(p: Placed, zone?: number): string {
  const where = zone === undefined ? '' : `, in Zone ${String.fromCharCode(65 + zone)}`;
  return `Your ${p.info.noun} ${p.item.name}${where}.`;
}
