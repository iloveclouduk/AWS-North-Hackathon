import { GetCostAndUsageCommand, type CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import ceServices from '../../../shared/ce-services.json' with { type: 'json' };
import { classifyAwsError } from '../aws.js';
import { log, who } from '../log.js';
import type { BillStore } from '../store/types.js';
import { serviceById, type CityBillEvent, type CityBillReadyEvent, type ServerEvent } from '../world.js';

type Emit = (e: ServerEvent) => void;

/**
 * The city's bill (contract v2.5): the account's month-to-date cost from Cost Explorer. Cost Explorer charges $0.01 per
 * request, so it's off by default; while the player has it on it's read when turned on and then at most once a day.
 */
export const BILL_TTL_MS = 24 * 60 * 60_000;
/** A failure that may pass (throttled, a network blip) is tried again sooner than a day. */
export const BILL_RETRY_MS = 60 * 60_000;
/** Pages per read (each one is a $0.01 request); a learner's account fits in one. */
const MAX_PAGES = 3;

const MAP = ceServices.map as Record<string, string>;

/** Cost Explorer's SERVICE name → our landmark id, or 'other'. */
export const serviceForCe = (name: string): string => {
  const id = MAP[name];
  return id && serviceById(id) ? id : 'other';
};

/** Cost Explorer's REGION value → a Region code, or 'global' (charges with no Region). */
export const regionForCe = (region: string | undefined): string => (!region || region === 'global' || region === 'NoRegion' ? 'global' : region);

const cents = (n: number) => Math.round(n * 100) / 100;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** This month so far, in UTC like Cost Explorer: the 1st → tomorrow (End is exclusive, so today is in; on the 1st it's one day). */
export const billPeriod = (now: Date) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { Start: day(start), End: day(end), month: day(start).slice(0, 7) };
};

/** One plain sentence for a bill that can't be read (players never see internal errors). */
export const billUnavailable = (err: unknown): { text: string; retryMs: number } => {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'DataUnavailableException') return { text: 'Cost Explorer is turning on for this account; bills show up within 24 hours.', retryMs: BILL_TTL_MS };
  if (classifyAwsError(err) === 'denied' || name === 'OptInRequired' || name === 'SubscriptionRequiredException')
    return { text: "Your bill isn't available: this account can't read Cost Explorer.", retryMs: BILL_TTL_MS };
  return { text: "Your bill isn't available right now. The city will try again later.", retryMs: BILL_RETRY_MS };
};

/** Month-to-date UnblendedCost by service and Region (one request per page). Throws AWS errors as they are. */
export const readBill = async (ce: CostExplorerClient, now = new Date()): Promise<CityBillReadyEvent> => {
  const { Start, End, month } = billPeriod(now);
  const byService: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  let total = 0;
  let currency: string | undefined;
  let NextPageToken: string | undefined;
  let pages = 0;
  do {
    const page = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start, End },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [
          { Type: 'DIMENSION', Key: 'SERVICE' },
          { Type: 'DIMENSION', Key: 'REGION' },
        ],
        NextPageToken,
      }),
    );
    for (const r of page.ResultsByTime ?? []) {
      for (const g of r.Groups ?? []) {
        const cost = g.Metrics?.UnblendedCost;
        const amount = Number(cost?.Amount ?? 0);
        if (!Number.isFinite(amount) || amount === 0) continue;
        currency ??= cost?.Unit;
        const [service = '', region] = g.Keys ?? [];
        const s = serviceForCe(service);
        const rg = regionForCe(region);
        byService[s] = (byService[s] ?? 0) + amount;
        byRegion[rg] = (byRegion[rg] ?? 0) + amount;
        total += amount;
      }
    }
    NextPageToken = page.NextPageToken || undefined;
  } while (NextPageToken && ++pages < MAX_PAGES);
  const rounded = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, cents(v)] as const).filter(([, v]) => v !== 0));
  return { type: 'city.bill', month, currency: currency ?? 'USD', total: cents(total), byService: rounded(byService), byRegion: rounded(byRegion), takenAt: now.toISOString(), estimated: true };
};

/**
 * One player's bill: whether it's on, the cached last read (per AWS account), and the reads themselves. Reads are
 * coalesced, so two tabs connecting at once still make one request.
 */
export const createBill = (deps: {
  sub: string;
  store: BillStore;
  /** The linked account's Cost Explorer client; absent = no AWS account linked yet. */
  ce?: () => CostExplorerClient;
  accountId?: string;
  /** Every open tab of the player. */
  broadcast: (events: ServerEvent[]) => void;
  now?: () => number;
}) => {
  const now = deps.now ?? Date.now;
  let reading: Promise<void> | undefined;

  /** The stored record; null when the store couldn't be read (undefined = nothing stored yet). */
  const load = () => deps.store.get(deps.sub).catch((err) => (log.warn('bill store read failed', { who: who(deps.sub), err: (err as Error).name }), null));
  const record = async () => (await load()) ?? undefined;
  /** The cached read, if it's for this account and still fresh. */
  const fresh = (r: Awaited<ReturnType<typeof record>>) =>
    r?.bill && r.accountId === deps.accountId && r.fetchedAt !== undefined && now() - r.fetchedAt < (r.retryMs ?? BILL_TTL_MS) ? r.bill : undefined;

  const unlinked = (): CityBillEvent => ({ type: 'city.bill', unavailable: 'Connect your AWS account first, then the city can show its bill.', takenAt: new Date(now()).toISOString() });

  const read = () =>
    (reading ??= (async () => {
      if (!deps.ce) return;
      let bill: CityBillEvent;
      let retryMs = BILL_TTL_MS;
      try {
        bill = await readBill(deps.ce(), new Date(now()));
      } catch (err) {
        const u = billUnavailable(err);
        if (u.retryMs === BILL_RETRY_MS) log.warn('bill read failed', { who: who(deps.sub), err: (err as Error).name });
        bill = { type: 'city.bill', unavailable: u.text, takenAt: new Date(now()).toISOString() };
        retryMs = u.retryMs;
      }
      // Saved only if it's still on (the player may have turned it off while Cost Explorer answered); the read
      // never writes `on` itself, so it can't turn the bill back on.
      const saved = await deps.store
        .saveRead(deps.sub, { bill, fetchedAt: now(), retryMs, accountId: deps.accountId })
        .catch((err) => (log.warn('bill store write failed', { who: who(deps.sub), err: (err as Error).name }), false));
      if (saved) deps.broadcast([bill]);
    })().finally(() => (reading = undefined)));

  return {
    /** On connect: the cached bill while it's on; a stale one is read again (and broadcast when it arrives). */
    async welcome(): Promise<ServerEvent[]> {
      const r = await record();
      if (!r?.on) return [];
      if (!deps.ce) return [unlinked()];
      const cached = fresh(r);
      if (!cached) void read();
      return r.bill && r.accountId === deps.accountId ? [r.bill] : [];
    },
    /** bill.enable: remember the choice; turning it on shows the cached bill, or reads it (at most once a day). */
    async enable(on: boolean, emit: Emit) {
      // Only the switch is written: the cached read is kept even when the record couldn't be read just now.
      await deps.store.setOn(deps.sub, on);
      if (!on) return;
      if (!deps.ce) return emit(unlinked());
      const r = await load();
      // Unknown whether a fresh read is cached: don't spend $0.01 finding out; the next refresh tries again.
      if (r === null) return emit({ type: 'city.bill', unavailable: "Your bill isn't available right now. The city will try again later.", takenAt: new Date(now()).toISOString() });
      const cached = fresh(r);
      if (cached) return emit(cached);
      await read();
    },
    /** The 5-minute refresh: reads again only when it's on and the last read is a day old. */
    async tick() {
      if (!deps.ce) return;
      const r = await record();
      if (r?.on && !fresh(r)) await read();
    },
  };
};

export type Bill = ReturnType<typeof createBill>;
