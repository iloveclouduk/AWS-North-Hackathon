/**
 * DynamoDB Sorting Office rules (pure: no Phaser, no store).
 * Every parcel carries a key; the key decides its shelf (DynamoDB hashes the partition key to pick a
 * partition, and the same key always lands in the same one). Each shelf only takes so many parcels a
 * second: past that it is "too busy" and the parcel is throttled until the shelf catches up. In the hot
 * moment one key floods in; spreading it (adding a number to the key, like write sharding) shares the load.
 */
export const SORT = {
  seconds: 50,
  /** The hot moment: one key floods in. */
  hotFrom: 16,
  hotTo: 32,
  hotKey: '🍎',
  /** Share of parcels carrying the hot key during the hot moment. */
  hotShare: 0.7,
  /** A shelf holds this many parcels being put away at once… */
  shelfCap: 3,
  /** …and puts this many away a second. */
  drainPerS: 0.6,
  spawnMs: 1500,
  hotSpawnMs: 700,
  /** Sorted this quickly after reaching the front: full points. */
  quickMs: 2000,
  /** Parcels waiting on the belt; one more falls off. */
  beltMax: 6,
} as const;

/** Shelf n (0-based) holds these keys. */
export const SHELVES: readonly (readonly string[])[] = [
  ['🍎', '🐱'],
  ['🍌', '🐶'],
  ['🍇', '🐸'],
  ['🍒', '🐧'],
];
export const KEYS = SHELVES.flat();

export interface Parcel {
  key: string;
  /** After spreading: the hot key carries a number 1–4, and that number is its shelf. */
  part?: number;
}

export const label = (p: Parcel) => `${p.key}${p.part ?? ''}`;

/** The shelf a parcel belongs on. The same key always goes to the same shelf. */
export function shelfFor(p: Parcel): number {
  if (p.part) return p.part - 1;
  return SHELVES.findIndex((s) => s.includes(p.key));
}

export const isHot = (t: number) => t >= SORT.hotFrom && t < SORT.hotTo;
export const spawnMs = (t: number) => (isHot(t) ? SORT.hotSpawnMs : SORT.spawnMs);

/** The next parcel at second `t`. Once keys are spread, the hot key gets a number from 1 to 4. */
export function nextParcel(t: number, spread: boolean, rand: () => number = Math.random): Parcel {
  const key = isHot(t) && rand() < SORT.hotShare ? SORT.hotKey : KEYS[Math.floor(rand() * KEYS.length)];
  return key === SORT.hotKey && spread ? { key, part: 1 + Math.floor(rand() * SHELVES.length) } : { key };
}

/** Shelves put parcels away as time passes. */
export const drain = (loads: number[], dtS: number) => loads.map((l) => Math.max(0, l - SORT.drainPerS * dtS));

/** Send a parcel to a shelf: it fits, or the shelf is too busy (throttled) and the parcel must wait. */
export function send(loads: number[], shelf: number): 'ok' | 'busy' {
  if (loads[shelf] + 1 > SORT.shelfCap) return 'busy';
  loads[shelf] += 1;
  return 'ok';
}

export const sortPoints = (waitMs: number) => (waitMs <= SORT.quickMs ? 10 : 6);

export interface SortStats {
  sorted: number;
  wrong: number;
  throttled: number;
  dropped: number;
  spread: boolean;
}
export const newSortStats = (): SortStats => ({ sorted: 0, wrong: 0, throttled: 0, dropped: 0, spread: false });

/** 1 star for finishing, +1 for spreading the hot key, +1 for careful sorting (few wrong shelves or dropped parcels). */
export function sortStars(st: SortStats): 1 | 2 | 3 {
  return (1 + (st.spread ? 1 : 0) + (st.wrong <= 2 && st.dropped <= 2 ? 1 : 0)) as 1 | 2 | 3;
}

export const SORT_LESSON = 'DynamoDB finds things fast by their key. Spread your keys so no shelf gets too busy.';

export function sortVerdict(st: SortStats): string {
  if (!st.spread) return `Too many ${SORT.hotKey} on one shelf!`;
  if (st.wrong > 2 || st.dropped > 2) return 'Nice spreading! Check each key’s shelf.';
  return 'Perfect sorting!';
}
