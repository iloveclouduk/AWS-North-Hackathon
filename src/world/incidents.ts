// AWS Health Dashboard events (contract v2.6) as the city reads them: which Regions, landmarks and zones they touch,
// how bad, and what each one teaches. Pure, so the UI, the scenes and the tests share one reading.
import type { AwsHealthEvent, AwsIncident } from '@/backend/contract';
import { regionInfo } from './regions';
import { serviceById } from './taxonomy';

export type Severity = AwsIncident['severity'];
const RANK: Record<Severity, number> = { informational: 1, degradation: 2, disruption: 3 };
export const severityRank = (s: Severity) => RANK[s];

/** Open incidents, worst and newest first. */
export const openIncidents = (health: AwsHealthEvent | undefined): AwsIncident[] =>
  (health?.incidents ?? []).filter((i) => i.status === 'open').sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.updated.localeCompare(a.updated));

/** Open incidents in this Region (global ones count everywhere). */
export const incidentsIn = (health: AwsHealthEvent | undefined, region: string) => openIncidents(health).filter((i) => i.region === region || i.region === 'global');

/** The worst open severity per Region, for the world map. */
export const worstByRegion = (health: AwsHealthEvent | undefined): Record<string, Severity> => {
  const out: Record<string, Severity> = {};
  for (const i of openIncidents(health)) if (i.region !== 'global' && (!out[i.region] || RANK[i.severity] > RANK[out[i.region]])) out[i.region] = i.severity;
  return out;
};

/**
 * How the city shows an incident in its Region: 'region' when most of the city's landmarks are hit (a Region-wide
 * event, like Bahrain 2026), else 'services' for the landmarks named.
 */
export const REGION_WIDE_SHARE = 0.5;
export type Impact = Exclude<Severity, 'informational'>;
export function cityImpact(incidents: AwsIncident[], landmarkCount: number) {
  const services = new Map<string, Impact>();
  const azIds = new Set<string>();
  let regionWide: Impact | undefined;
  for (const i of incidents) {
    if (i.severity === 'informational') continue;
    if (i.serviceIds.length >= landmarkCount * REGION_WIDE_SHARE && (!regionWide || RANK[i.severity] > RANK[regionWide])) regionWide = i.severity;
    for (const id of i.serviceIds) if (!services.has(id) || RANK[i.severity] > RANK[services.get(id)!]) services.set(id, i.severity);
    for (const az of i.azIds ?? []) azIds.add(az);
  }
  return { regionWide, services, azIds: [...azIds] };
}

/** "Bahrain (me-south-1)". */
export const incidentWhere = (i: AwsIncident) => {
  if (i.region === 'global') return 'All Regions';
  const name = i.regionName ?? regionInfo(i.region)?.name;
  return name ? `${name} (${i.region})` : i.region;
};

/** One line for the ticker: "Bahrain (me-south-1): 144 services disrupted". */
export function incidentLine(i: AwsIncident) {
  const what = i.serviceCount > 1 ? `${i.serviceCount} services` : (i.services[0] ?? (i.serviceIds[0] && serviceById(i.serviceIds[0])?.name) ?? 'a service');
  const how = i.status === 'resolved' ? 'recovered' : i.severity === 'disruption' ? 'disrupted' : i.severity === 'degradation' ? 'degraded' : 'notice';
  return `${incidentWhere(i)}: ${what} ${how}`;
}

/** "3 min ago", "2 h ago", "4 days ago", "7 months ago". */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 45) return `${Math.round(s / 86400)} days ago`;
  return `${Math.round(s / (86400 * 30))} months ago`;
}

export interface IncidentLesson {
  title: string;
  text: string;
  /** Flashcards to practise (the landmark whose deck opens). */
  practise: string;
  /** The architecture puzzle that rehearses it. */
  puzzleId?: string;
}

/**
 * What an incident teaches, by its shape: a whole Region lost (only copies elsewhere help), one zone down (multi-AZ
 * is the answer), or a service having a bad day (retries and fallbacks).
 */
export function lessonFor(i: AwsIncident, landmarkCount: number): IncidentLesson {
  if (i.severity === 'disruption' && i.serviceIds.length >= landmarkCount * REGION_WIDE_SHARE)
    return {
      title: 'Why a second Region matters',
      text: 'Spreading across Availability Zones protects you when one building fails. When a whole Region is lost, only copies in another Region help: backups copied there, and a way to send customers there.',
      practise: 's3',
      puzzleId: 'region-down',
    };
  if (i.azIds?.length)
    return {
      title: 'Why spread across Availability Zones',
      text: 'Each Availability Zone is separate buildings with their own power. Apps that run in two or more zones keep answering when one zone has trouble.',
      practise: 'ec2',
      puzzleId: 'region-down',
    };
  const svc = i.serviceIds.find((id) => serviceById(id)) ?? 'cloudwatch';
  return {
    title: 'Expect the occasional bad day',
    text: 'Even managed services slow down sometimes. Retry with backoff, set timeouts, alarm on errors, and have a fallback, so a slow dependency doesn’t take your whole app down.',
    practise: svc,
  };
}
