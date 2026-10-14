import { GetMetricDataCommand, type CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { classifyAwsError } from '../aws.js';
import { log, who } from '../log.js';
import type { CityFlowEvent, CityFlowReadyEvent, FlowRate, ServerEvent } from '../world.js';

type Emit = (e: ServerEvent) => void;

/**
 * Live traffic (contract v2.8): a few request counts from the linked account's CloudWatch, so the city's request cars
 * follow real use. Off by default. While it's on and the player has the city open, it's read at most every 5 minutes
 * (and at most MAX_READS_PER_DAY times a day): one allow-listed Metrics Insights query per GetMetricData call (the API
 * takes one per call), each billed per metric it analyzes, so a learner's account costs about a cent a day.
 */
export const FLOW_TTL_MS = 5 * 60_000;
/** A failure that may pass is tried again later; "denied" (an older AWS City role) waits a day. */
export const FLOW_RETRY_MS = 60 * 60_000;
export const FLOW_DENIED_RETRY_MS = 24 * 60 * 60_000;
export const MAX_READS_PER_DAY = 96;
export const WINDOW_MIN = 15;

/** The only queries the server ever sends: fixed text, never built from anything a player or a metric says. */
export const FLOW_QUERIES: { id: string; serviceId: string; kind: FlowRate['kind']; label: string; byAz?: true; expression: string }[] = [
  {
    id: 'alb',
    serviceId: 'ec2',
    kind: 'requests',
    label: 'Load balancer requests',
    byAz: true,
    expression: 'SELECT SUM(RequestCount) FROM SCHEMA("AWS/ApplicationELB", AvailabilityZone, LoadBalancer) GROUP BY AvailabilityZone',
  },
  { id: 'lambda', serviceId: 'lambda', kind: 'invocations', label: 'Lambda invocations', expression: 'SELECT SUM(Invocations) FROM SCHEMA("AWS/Lambda", FunctionName)' },
  { id: 'apigateway', serviceId: 'apigateway', kind: 'requests', label: 'API requests', expression: 'SELECT SUM("Count") FROM SCHEMA("AWS/ApiGateway", ApiName)' },
  { id: 'dynamodb', serviceId: 'dynamodb', kind: 'writes', label: 'DynamoDB writes', expression: 'SELECT SUM(ConsumedWriteCapacityUnits) FROM SCHEMA("AWS/DynamoDB", TableName)' },
];

/** A finite, non-negative per-minute rate (metric values are numbers from AWS, but never trusted blindly). */
const perMin = (total: number) => (Number.isFinite(total) && total > 0 ? Math.round(total / WINDOW_MIN) : 0);
/** An Availability Zone name as CloudWatch labels it (us-west-2a); anything else is dropped. */
const AZ_NAME = /^[a-z]{2}(-[a-z]+)+-\d[a-z]$/;

/** One plain sentence for traffic that can't be read (players never see internal errors). */
export const flowUnavailable = (err: unknown): { text: string; retryMs: number } =>
  classifyAwsError(err) === 'denied'
    ? { text: 'Live traffic needs the updated AWS City role in your account (it adds cloudwatch:GetMetricData).', retryMs: FLOW_DENIED_RETRY_MS }
    : { text: "Live traffic isn't available right now. The city will try again later.", retryMs: FLOW_RETRY_MS };

/** The last WINDOW_MIN minutes of each allow-listed query. Throws AWS errors as they are. */
export const readFlow = async (cw: CloudWatchClient, region: string, now = new Date()): Promise<CityFlowReadyEvent> => {
  const EndTime = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const StartTime = new Date(EndTime.getTime() - WINDOW_MIN * 60_000);
  const rates: FlowRate[] = [];
  for (const q of FLOW_QUERIES) {
    const out = await cw.send(
      new GetMetricDataCommand({ StartTime, EndTime, MetricDataQueries: [{ Id: 'q', Expression: q.expression, Period: 300 }], MaxDatapoints: 100 }),
    );
    let total = 0;
    const byAz: Record<string, number> = {};
    for (const r of out.MetricDataResults ?? []) {
      const sum = (r.Values ?? []).reduce((a, v) => a + (Number.isFinite(v) && v > 0 ? v : 0), 0);
      total += sum;
      if (q.byAz && r.Label && AZ_NAME.test(r.Label)) byAz[r.Label] = perMin(sum);
    }
    const rate = perMin(total);
    if (rate > 0) rates.push({ id: q.id, serviceId: q.serviceId, kind: q.kind, label: q.label, perMin: rate, ...(q.byAz && Object.keys(byAz).length ? { byAz } : {}) });
  }
  return { type: 'city.flow', region, windowMin: WINDOW_MIN, rates, takenAt: now.toISOString() };
};

/**
 * One player's live traffic: whether it's on (the client sends flow.enable, from Progress.flow, on every connect), the
 * last read in memory, and the reads themselves, coalesced so two tabs share one. Nothing is stored: it's minutes old.
 */
export const createFlow = (deps: {
  sub: string;
  /** The linked account's CloudWatch client; absent = no AWS account linked yet. */
  cw?: () => CloudWatchClient;
  region: string;
  /** On from the start (the switch outlives a world rebuilt by linking an account). */
  initialOn?: boolean;
  /** Every open tab of the player. */
  broadcast: (events: ServerEvent[]) => void;
  /** Whether any tab of the player is connected (reads only while someone is looking). */
  active: () => boolean;
  now?: () => number;
}) => {
  const now = deps.now ?? Date.now;
  let on = !!deps.initialOn;
  let last: { event: CityFlowEvent; at: number; retryMs: number } | undefined;
  let reading: Promise<void> | undefined;
  let day = '';
  let readsToday = 0;

  const fresh = () => !!last && now() - last.at < last.retryMs;
  const unlinked = (): CityFlowEvent => ({ type: 'city.flow', unavailable: 'Connect your AWS account first, then the city can show its live traffic.', takenAt: new Date(now()).toISOString() });

  const read = () =>
    (reading ??= (async () => {
      if (!deps.cw) return;
      const today = new Date(now()).toISOString().slice(0, 10);
      if (today !== day) (day = today), (readsToday = 0);
      if (readsToday >= MAX_READS_PER_DAY) return;
      readsToday++;
      let event: CityFlowEvent;
      let retryMs = FLOW_TTL_MS;
      try {
        event = await readFlow(deps.cw(), deps.region, new Date(now()));
      } catch (err) {
        const u = flowUnavailable(err);
        log.warn('flow read failed', { who: who(deps.sub), err: (err as Error).name });
        event = { type: 'city.flow', unavailable: u.text, takenAt: new Date(now()).toISOString() };
        retryMs = u.retryMs;
      }
      last = { event, at: now(), retryMs };
      if (on) deps.broadcast([event]);
    })().finally(() => (reading = undefined)));

  return {
    /** On connect: the last read while it's on (the client re-sends flow.enable from Progress.flow anyway). */
    welcome(): ServerEvent[] {
      return on && last ? [last.event] : [];
    },
    /** flow.enable: remember the choice; turning it on shows the last read, or reads now. */
    async enable(want: boolean, emit: Emit) {
      on = want;
      if (!on) return;
      if (!deps.cw) return emit(unlinked());
      if (fresh()) return emit(last!.event);
      const before = last;
      await read(); // a new read reaches every tab (this one too) through broadcast
      if (last && last === before) emit(last.event); // none was made (today's reads are used up): the last one
    },
    /** The scheduler's tick: reads again only when on, someone's looking, and the last read is old. */
    async tick() {
      if (on && deps.cw && deps.active() && !fresh()) await read();
    },
  };
};

export type Flow = ReturnType<typeof createFlow>;
