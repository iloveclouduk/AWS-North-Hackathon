// Architecture diagram rules, kept free of React: which boxes are slots, what may be dropped where, and the
// edges the data actually flows along once the player has built the design.
import type { Diagram, DiagramEdge, Puzzle } from '@/world/content';
import { productName } from '@/world/icons';
import { serviceById } from '@/world/taxonomy';

export interface Slot {
  /** The node id, or the group id for a group's label tab. */
  id: string;
  service: string;
  accepts: string[];
  required: boolean;
  role: string;
  kind: 'node' | 'badge' | 'group';
}

/** Slot id → the service placed there. */
export type Placements = Record<string, string>;

export type PlaceResult =
  | { ok: true; placements: Placements }
  | { ok: false; reason: 'distractor' | 'wrong-slot' | 'taken' | 'none-left' | 'no-slot'; message: string };

export const shortName = (serviceId: string) => serviceById(serviceId)?.name.replace(/^(Amazon|AWS) /, '') ?? serviceId;
/** What a slot holds, by name: the product it shows (CloudTrail) or the service's short name. */
export const slotName = (p: Puzzle, slotId: string, serviceId: string) => {
  const shows = p.diagram?.nodes.find((n) => n.id === slotId)?.shows;
  return (shows && productName(shows)?.replace(/^(Amazon|AWS) /, '')) || shortName(serviceId);
};

export function slotsOf(p: Puzzle): Slot[] {
  const d = p.diagram;
  if (!d) return [];
  const req = new Set(p.required);
  const nodes = d.nodes
    .filter((n) => n.service)
    .map((n): Slot => ({ id: n.id, service: n.service!, accepts: n.accepts ?? [], required: req.has(n.service!), role: n.role, kind: n.attachTo ? 'badge' : 'node' }));
  const groups = d.groups
    .filter((g) => g.service)
    .map((g): Slot => ({ id: g.id, service: g.service!, accepts: [], required: req.has(g.service!), role: g.label, kind: 'group' }));
  return [...nodes, ...groups];
}

const fits = (s: Slot, svc: string) => s.service === svc || s.accepts.includes(svc);

/** How many cards of each service are still in the tray: one per open slot that wants it, and one per distractor. */
export function remainingCards(p: Puzzle, placements: Placements): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of slotsOf(p)) if (!placements[s.id]) out[s.service] = (out[s.service] ?? 0) + 1;
  for (const s of p.distractors) out[s] = 1;
  return out;
}

export function tryPlace(p: Puzzle, placements: Placements, slotId: string, svc: string): PlaceResult {
  const slot = slotsOf(p).find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: 'no-slot', message: 'That isn’t a slot.' };
  if (p.distractors.includes(svc)) return { ok: false, reason: 'distractor', message: p.diagram?.rejects[svc] ?? `${shortName(svc)} doesn’t belong in this design.` };
  if (placements[slotId]) return { ok: false, reason: 'taken', message: `That spot already has ${shortName(placements[slotId])}. Pick it up first.` };
  if (!fits(slot, svc)) return { ok: false, reason: 'wrong-slot', message: `${shortName(svc)} doesn’t fit this spot.` };
  if (!(remainingCards(p, placements)[svc] > 0)) return { ok: false, reason: 'none-left', message: `Every ${shortName(svc)} spot is already filled.` };
  return { ok: true, placements: { ...placements, [slotId]: svc } };
}

/** Take a placed service back into the hand. */
export function pickUp(placements: Placements, slotId: string): { placements: Placements; service?: string } {
  const service = placements[slotId];
  if (!service) return { placements };
  const next = { ...placements };
  delete next[slotId];
  return { placements: next, service };
}

/** Is this node in the picture? Actors always are; slots once filled; mirrors once their original is. */
export function isFilled(d: Diagram, placements: Placements, nodeId: string, seen = new Set<string>()): boolean {
  const n = d.nodes.find((x) => x.id === nodeId);
  if (!n || seen.has(nodeId)) return false;
  seen.add(nodeId);
  if (n.actor || n.fixed) return true;
  if (n.mirrorOf) return isFilled(d, placements, n.mirrorOf, seen);
  return !!placements[n.id];
}

/**
 * The edges of the design the player actually built. An empty node with exactly one stepped edge in and one out
 * is bypassed (A→empty→B becomes A→B, keeping A's label); any other edge touching an empty node is dropped.
 */
export function effectiveEdges(d: Diagram, placements: Placements): DiagramEdge[] {
  let edges = [...d.edges];
  const empty = d.nodes.filter((n) => !n.attachTo && !isFilled(d, placements, n.id)).map((n) => n.id);
  for (const id of empty) {
    const ins = edges.filter((e) => e.to === id && e.step);
    const outs = edges.filter((e) => e.from === id && e.step);
    const rest = edges.filter((e) => e.to !== id && e.from !== id);
    edges = ins.length === 1 && outs.length === 1 && ins[0].from !== outs[0].to ? [...rest, { ...ins[0], to: outs[0].to }] : rest;
  }
  return edges;
}

/** Stepped edges grouped by step, in order (edges with the same step run together). */
export function flowSteps(edges: DiagramEdge[]): DiagramEdge[][] {
  const steps = [...new Set(edges.filter((e) => e.step).map((e) => e.step!))].sort((a, b) => a - b);
  return steps.map((s) => edges.filter((e) => e.step === s));
}

/** The next required slot to fill, in flow order (for the hint). */
export function nextEmptyRequired(p: Puzzle, placements: Placements): Slot | undefined {
  const d = p.diagram;
  const order = (id: string) => Math.min(...(d?.edges.filter((e) => (e.from === id || e.to === id) && e.step).map((e) => e.step!) ?? []), 99);
  return slotsOf(p)
    .filter((s) => s.required && !placements[s.id])
    .sort((a, b) => order(a.id) - order(b.id))[0];
}
