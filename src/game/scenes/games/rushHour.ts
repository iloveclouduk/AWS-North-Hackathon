/**
 * EC2 Rush Hour rules (pure: no Phaser, no store), so tests can play whole days.
 * Customers arrive in waves; the player adds and removes servers. A server serves `perServer` customers
 * a second and takes `bootS` seconds to start (a real instance takes a moment to boot, so scale a little early).
 */
export const RUSH = {
  seconds: 54,
  minServers: 1,
  maxServers: 8,
  bootS: 2,
  perServer: 1,
  /** A line this long (or longer) is a long queue. */
  longQueue: 6,
  /** Past this many waiting, new customers give up and leave. */
  maxQueue: 20,
  /** Stars: at most this many seconds with a long queue… */
  okLongQueueS: 6,
  /** …and at most this many server-seconds spent idle. */
  okIdleS: 30,
} as const;

export type Phase = 'morning' | 'lunch' | 'evening';
export const PHASES: { id: Phase; from: number; label: string }[] = [
  { id: 'morning', from: 0, label: '🌅 Morning: quiet' },
  { id: 'lunch', from: 18, label: '🍔 Lunch rush!' },
  { id: 'evening', from: 36, label: '🌙 Evening: calm' },
];

export const phaseAt = (t: number): Phase => [...PHASES].reverse().find((p) => t >= p.from)!.id;

/** Customers a second at second `t`: morning 1→2, lunch 3→6→3, evening 2→1. */
export function demandAt(t: number): number {
  if (t < 18) return 1 + t / 18;
  if (t < 36) return 3 + 3 * Math.sin((Math.PI * (t - 18)) / 18);
  return Math.max(1, 2 - (t - 36) / 18);
}

/** Whole customers arriving this second: the demand, with its fraction rounded by chance. */
export function arrivals(t: number, rand: () => number = Math.random): number {
  const d = demandAt(t);
  const n = Math.floor(d);
  return n + (rand() < d - n ? 1 : 0);
}

export interface RushStats {
  served: number;
  lost: number;
  /** Seconds the line was long. */
  longQueueS: number;
  /** Server-seconds a running server had nobody to serve. */
  idleS: number;
}
export interface RushState {
  t: number;
  queue: number;
  ready: number;
  /** Seconds left for each server still starting. */
  booting: number[];
  stats: RushStats;
}

export const newRush = (): RushState => ({ t: 0, queue: 0, ready: RUSH.minServers, booting: [], stats: { served: 0, lost: 0, longQueueS: 0, idleS: 0 } });

export const serverCount = (s: RushState) => s.ready + s.booting.length;

export function addServer(s: RushState): boolean {
  if (serverCount(s) >= RUSH.maxServers) return false;
  s.booting.push(RUSH.bootS);
  return true;
}

/** Stops a server: one still starting first, else a running one, never below the minimum. */
export function removeServer(s: RushState): boolean {
  if (s.booting.length) return (s.booting.pop(), true);
  if (s.ready <= RUSH.minServers) return false;
  s.ready--;
  return true;
}

export interface Tick {
  arrived: number;
  served: number;
  idle: number;
  long: boolean;
  lost: number;
  points: number;
}

/** One second of the day: servers finish booting, customers join the line, servers serve. */
export function tick(s: RushState, arrived: number): Tick {
  s.booting = s.booting.map((b) => b - 1);
  s.ready += s.booting.filter((b) => b <= 0).length;
  s.booting = s.booting.filter((b) => b > 0);
  const room = RUSH.maxQueue - s.queue;
  const lost = Math.max(0, arrived - room);
  s.queue += arrived - lost;
  const served = Math.min(s.queue, s.ready * RUSH.perServer);
  s.queue -= served;
  const idle = s.ready - Math.ceil(served / RUSH.perServer);
  const long = s.queue >= RUSH.longQueue;
  s.t++;
  s.stats.served += served;
  s.stats.lost += lost;
  s.stats.idleS += idle;
  if (long) s.stats.longQueueS++;
  // Every customer served earns a point; idle servers cost money; a long line upsets people.
  const points = served - idle - (long ? 3 : 0) - lost * 2;
  return { arrived, served, idle, long, lost, points };
}

/** 1 star for finishing, +1 for short lines, +1 for few idle servers. */
export function rushStars(st: RushStats): 1 | 2 | 3 {
  return (1 + (st.longQueueS <= RUSH.okLongQueueS ? 1 : 0) + (st.idleS <= RUSH.okIdleS ? 1 : 0)) as 1 | 2 | 3;
}

export const RUSH_LESSON = 'Auto Scaling adds servers when it’s busy and removes them when it’s quiet, so you only pay for what you use.';

export function rushVerdict(st: RushStats): string {
  const long = st.longQueueS > RUSH.okLongQueueS;
  const idle = st.idleS > RUSH.okIdleS;
  if (long && idle) return 'Lines got long and servers sat idle.';
  if (long) return 'Lines got long: add servers before the rush.';
  if (idle) return 'Some servers sat idle, and idle servers still cost money.';
  return 'Perfect scaling!';
}
