// Fire-and-forget events between the runtime, React UI and Phaser scenes.
// Persistent state lives in the store; the bus carries "something just happened" moments
// (animations, camera moves, clicks) that don't belong in state.

import type { ServerEvent } from '@/backend/contract';
import type { PageFocus } from './types';

export interface BusEvents {
  /** Every event from the backend, after the store has applied it. */
  server: ServerEvent;
  /** The browser tab the user is looking at changed. */
  focus: PageFocus;
  discovered: { serviceId: string };
  tierUp: { serviceId: string; tier: number };
  /** Camera fly-to a landmark id ('s3', 'hq:storage', 'plaza') or district id. */
  flyTo: { id: string };
  /** Lookout is snapping a photo (animation). */
  snap: { phase: 'start' | 'done' | 'failed' };
  /** Game → UI */
  select: { id: string };
  enterHq: { districtId: string };
  play: { game: 'fishing' };
  xpGained: { serviceId: string; amount: number };
  /** Dev/demo: force the day/night clock (hour 0–24) or undefined for real time. */
  hour: { hour?: number };
  /** UI asks the city to animate an architecture: packets flow between these services in order. */
  showFlow: { serviceIds: string[] };
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

  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]) {
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
