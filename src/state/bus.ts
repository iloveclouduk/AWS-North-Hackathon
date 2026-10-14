// Fire-and-forget events between the runtime, React UI and Phaser scenes.
// Persistent state lives in the store; the bus carries "something just happened" moments
// (animations, camera moves, clicks) that don't belong in state.

import type { AwsIncident, CityFinding, ServerEvent } from '@/backend/contract';
import type { Cargo } from '@/world/carriers';
import type { PageFocus } from './types';
import type { CitizenRequest } from './requests';

export interface BusEvents {
  /** Every event from the backend, after the store has applied it. */
  server: ServerEvent;
  /** The browser tab the user is looking at changed. */
  focus: PageFocus;
  /** A new landmark. `quiet`: built because a finding or XP needed it (no camera move, toast or greeting). */
  discovered: { serviceId: string; quiet?: boolean };
  tierUp: { serviceId: string; tier: number };
  /** Camera fly-to a landmark id ('s3', 'hq:storage', 'plaza') or district id. */
  flyTo: { id: string };
  /**
   * UI asks Kai to walk to a landmark (a quest's visit step): the city calls `accept()` when it will, and the visit
   * counts when Kai arrives. Not accepted (the city asleep behind a game or HQ) → the caller counts it at once.
   */
  walkTo: { id: string; accept: () => void };
  /** Kai reached a citizen with a question (src/state/requests.ts): the UI shows it. */
  citizenRequest: { request: CitizenRequest; name: string };
  /** Lookout is snapping a photo (animation). */
  snap: { phase: 'start' | 'done' | 'failed' };
  /** Game → UI */
  select: { id: string };
  enterHq: { districtId: string };
  questDone: { questId: string };
  xpGained: { serviceId: string; amount: number };
  /** Dev/demo: force the day/night clock (hour 0–24) or undefined for real time. */
  hour: { hour?: number };
  /** City care: a finding opened (or reopened); its citizen walks over and the landmark gets a marker. */
  findingRaised: { finding: CityFinding };
  /** A finding was resolved: the marker goes with a small celebration. `fixed` = after the player's fix. */
  findingResolved: { finding: CityFinding; fixed: boolean };
  /** A citizen reached a new level (Spotter → Fixer → Caretaker). */
  citizenLevelUp: { citizenId: string; level: number };
  /** UI asks the city to show a finding (camera to its landmark). */
  showFinding: { findingId: string };
  /** UI asks the city to animate an architecture: packets flow between these services in order. */
  showFlow: { serviceIds: string[] };
  /** v2.6: an AWS Health Dashboard event opened (not sent for those already open when the city loads). */
  incidentStarted: { incident: AwsIncident };
  /** v2.6: AWS resolved it (it left the dashboard). */
  incidentResolved: { incident: AwsIncident };
  /** The city has finished arriving (CityScene.arrive: camera settled), so a first-run tour can point at it. */
  arrived: void;
  /** A data carrier (a real DataLink's tanker, standby van, request car or an agent's courier) was tapped. */
  carrierTap: { cargo: Cargo };
  /** Save a postcard of the city (a PNG download, nothing uploaded). */
  postcard: void;
  /** A short line for screen readers (App's live region): what the keyboard just did in the city. */
  announce: { text: string };
  /** The tour asks where Kai stands on the page (CSS pixels); the city answers through `reply` (undefined: not shown). */
  locateKai: { reply: (r: { top: number; left: number; width: number; height: number } | undefined) => void };
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

class Bus {
  private handlers = new Map<keyof BusEvents, Set<Handler<never>>>();

  on<K extends keyof BusEvents>(type: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  /** A moment with no payload (`arrived`) can be emitted with just its type. */
  emit<K extends keyof BusEvents>(type: K, ...args: BusEvents[K] extends void ? [payload?: undefined] : [payload: BusEvents[K]]) {
    const payload = args[0] as BusEvents[K];
    for (const fn of this.handlers.get(type) ?? []) {
      try {
        (fn as Handler<K>)(payload);
      } catch (err) {
        console.error(`[bus] ${String(type)} handler failed`, err);
      }
    }
  }
}

export const bus = new Bus();
