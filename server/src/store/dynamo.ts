import { randomUUID } from 'node:crypto';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ProgressSchema } from '../contract/progress.js';
import { log } from '../log.js';
import type { Resource } from '../state/model.js';
import type { Progress } from '../world.js';
import { type AccountLocks, type AccountRecord, type BillRecord, DELETED_TOMBSTONE_MS, LockLostError, type Stores } from './types.js';

/**
 * Single-table design (infra/lib/data-stack.ts):
 *   USER#<sub>    PROGRESS | ACCOUNT | BILL | QUOTA#<day>
 *   QUOTA#GLOBAL  <day>
 *   AWSACCT#<id>  LOCK | PENDING#<kind:id>
 *   DELETED#<sub> TOMBSTONE   (DELETE /me: refuses the player's still-valid tokens for a while)
 * `ttl` (epoch seconds) expires quotas, locks, pending entries and tombstones.
 */
const LEASE_MS = 30_000;
/** A held lease is extended this often, so a change that waits minutes for approval keeps its lock. */
const RENEW_MS = 10_000;
const isConditional = (err: unknown) => (err as { name?: string })?.name === 'ConditionalCheckFailedException';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ttl = (ms: number) => Math.floor((Date.now() + ms) / 1000);

export const dynamoStores = (deps: { client: DynamoDBClient; table: string; now?: () => number; renewMs?: number }): Stores => {
  const db = DynamoDBDocumentClient.from(deps.client, { marshallOptions: { removeUndefinedValues: true } });
  const TableName = deps.table;
  const now = deps.now ?? Date.now;
  const user = (sub: string) => `USER#${sub}`;

  const locks: AccountLocks = {
    async withLock(accountKey, fn) {
      const pk = `AWSACCT#${accountKey}`;
      const owner = randomUUID();
      // Lease lock: a crashed task's lock simply expires.
      for (let attempt = 0; ; attempt++) {
        try {
          await db.send(
            new PutCommand({
              TableName,
              Item: { pk, sk: 'LOCK', owner, expiresAt: now() + LEASE_MS, ttl: ttl(LEASE_MS + 60_000) },
              ConditionExpression: 'attribute_not_exists(pk) OR expiresAt < :now',
              ExpressionAttributeValues: { ':now': now() },
            }),
          );
          break;
        } catch (err) {
          if (!isConditional(err) || attempt >= 40) throw isConditional(err) ? new Error('Another change to this AWS account is still running. Try again in a moment.') : err;
          await sleep(Math.min(1000, 50 * 2 ** attempt) + Math.random() * 50);
        }
      }
      // Renewed by its owner only (a lease that expired and was taken by someone else is never stolen back).
      // The lease aborts when it's lost (someone else owns it now) or might be (no renewal landed and it's about to
      // run out), so fn stops before its next AWS write.
      const renewMs = deps.renewMs ?? RENEW_MS;
      const lease = new AbortController();
      let validUntil = now() + LEASE_MS;
      const lose = (why: string) => {
        if (lease.signal.aborted) return;
        log.warn('account lock lost', { why });
        lease.abort(new LockLostError());
      };
      const renew = setInterval(() => {
        if (now() > validUntil - renewMs) return lose('not renewed in time');
        const expiresAt = now() + LEASE_MS;
        db.send(
          new UpdateCommand({
            TableName,
            Key: { pk, sk: 'LOCK' },
            UpdateExpression: 'SET expiresAt = :e, #ttl = :ttl',
            ConditionExpression: '#o = :o',
            ExpressionAttributeNames: { '#o': 'owner', '#ttl': 'ttl' },
            ExpressionAttributeValues: { ':o': owner, ':e': expiresAt, ':ttl': ttl(LEASE_MS + 60_000) },
          }),
        ).then(
          () => void (validUntil = Math.max(validUntil, expiresAt)),
          (err) => {
            log.warn('account lock renewal failed', { err: (err as Error).name, lost: isConditional(err) });
            if (isConditional(err)) lose('taken');
          },
        );
      }, renewMs);
      renew.unref?.();
      try {
        return await fn(lease.signal);
      } finally {
        clearInterval(renew);
        await db
          .send(new DeleteCommand({ TableName, Key: { pk, sk: 'LOCK' }, ConditionExpression: '#o = :o', ExpressionAttributeNames: { '#o': 'owner' }, ExpressionAttributeValues: { ':o': owner } }))
          .catch(() => undefined);
      }
    },
    async pending(accountKey) {
      const out = await db.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
          ExpressionAttributeValues: { ':pk': `AWSACCT#${accountKey}`, ':p': 'PENDING#' },
        }),
      );
      return (out.Items ?? []).filter((i) => (i.until as number) > now()).map((i) => i.resource as Resource);
    },
    async remember(accountKey, resource, ttlMs) {
      await db.send(
        new PutCommand({
          TableName,
          Item: { pk: `AWSACCT#${accountKey}`, sk: `PENDING#${resource.kind}:${resource.id}`, resource, until: now() + ttlMs, ttl: ttl(ttlMs + 60_000) },
        }),
      );
    },
  };

  return {
    progress: {
      async get(sub) {
        const out = await db.send(new GetCommand({ TableName, Key: { pk: user(sub), sk: 'PROGRESS' } }));
        const parsed = ProgressSchema.safeParse(out.Item?.doc);
        return parsed.success ? (parsed.data as Progress) : null;
      },
      async put(sub, input) {
        const parsed = ProgressSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
        const updatedAt = Date.parse(parsed.data.updatedAt);
        try {
          // Newest wins, atomically: an older copy never overwrites a newer one.
          await db.send(
            new PutCommand({
              TableName,
              Item: { pk: user(sub), sk: 'PROGRESS', doc: parsed.data, updatedAt },
              ConditionExpression: 'attribute_not_exists(updatedAt) OR updatedAt <= :u',
              ExpressionAttributeValues: { ':u': updatedAt },
            }),
          );
        } catch (err) {
          if (!isConditional(err)) throw err;
        }
        return { ok: true };
      },
    },
    accounts: {
      async get(sub) {
        const out = await db.send(new GetCommand({ TableName, Key: { pk: user(sub), sk: 'ACCOUNT' } }));
        return out.Item?.record as AccountRecord | undefined;
      },
      async put(sub, record) {
        await db.send(new PutCommand({ TableName, Item: { pk: user(sub), sk: 'ACCOUNT', record } }));
      },
    },
    // v2.5: the bill switch and the last Cost Explorer read (deleted with the rest of USER#<sub> by deleteUser).
    bills: {
      async get(sub) {
        const out = await db.send(new GetCommand({ TableName, Key: { pk: user(sub), sk: 'BILL' } }));
        return out.Item?.record as BillRecord | undefined;
      },
      async put(sub, record) {
        await db.send(new PutCommand({ TableName, Item: { pk: user(sub), sk: 'BILL', record } }));
      },
      async setOn(sub, on) {
        // `on` alone, in place: the cached read beside it is never rewritten. The first time there's no record to update
        // yet, so it's created (only if still absent; a race with another task just updates the one it made).
        for (let attempt = 0; ; attempt++) {
          try {
            await db.send(
              new UpdateCommand({
                TableName,
                Key: { pk: user(sub), sk: 'BILL' },
                UpdateExpression: 'SET #r.#on = :on',
                ConditionExpression: 'attribute_exists(#r)',
                ExpressionAttributeNames: { '#r': 'record', '#on': 'on' },
                ExpressionAttributeValues: { ':on': on },
              }),
            );
            return;
          } catch (err) {
            if (!isConditional(err) || attempt > 0) throw err;
          }
          try {
            await db.send(new PutCommand({ TableName, Item: { pk: user(sub), sk: 'BILL', record: { on } }, ConditionExpression: 'attribute_not_exists(pk)' }));
            return;
          } catch (err) {
            if (!isConditional(err)) throw err;
          }
        }
      },
      async saveRead(sub, read) {
        const fields = Object.entries(read).filter(([, v]) => v !== undefined);
        try {
          await db.send(
            new UpdateCommand({
              TableName,
              Key: { pk: user(sub), sk: 'BILL' },
              UpdateExpression: `SET ${fields.map((_, i) => `#r.#f${i} = :v${i}`).join(', ')}`,
              ConditionExpression: '#r.#on = :on',
              ExpressionAttributeNames: { '#r': 'record', '#on': 'on', ...Object.fromEntries(fields.map(([k], i) => [`#f${i}`, k])) },
              ExpressionAttributeValues: { ':on': true, ...Object.fromEntries(fields.map(([, v], i) => [`:v${i}`, v])) },
            }),
          );
          return true;
        } catch (err) {
          if (isConditional(err)) return false;
          throw err;
        }
      },
    },
    quota: {
      async consume(key, day, limit) {
        const isGlobal = key === 'GLOBAL';
        try {
          await db.send(
            new UpdateCommand({
              TableName,
              Key: isGlobal ? { pk: 'QUOTA#GLOBAL', sk: day } : { pk: user(key), sk: `QUOTA#${day}` },
              UpdateExpression: 'ADD calls :one SET #ttl = :ttl',
              ConditionExpression: 'attribute_not_exists(calls) OR calls < :limit',
              ExpressionAttributeNames: { '#ttl': 'ttl' },
              ExpressionAttributeValues: { ':one': 1, ':limit': limit, ':ttl': ttl(2 * 86_400_000) },
            }),
          );
          return true;
        } catch (err) {
          if (isConditional(err)) return false;
          throw err;
        }
      },
      async used(key, day) {
        const out = await db.send(new GetCommand({ TableName, Key: key === 'GLOBAL' ? { pk: 'QUOTA#GLOBAL', sk: day } : { pk: user(key), sk: `QUOTA#${day}` } }));
        return (out.Item?.calls as number | undefined) ?? 0;
      },
    },
    locks,
    /** Every item of the player, page by page; throttled deletes are retried (privacy: nothing may be left behind). */
    async deleteUser(sub) {
      // The tombstone first: a PUT /progress racing the delete (another task, a still-valid token) is refused from now on.
      await db.send(
        new PutCommand({ TableName, Item: { pk: `DELETED#${sub}`, sk: 'TOMBSTONE', until: now() + DELETED_TOMBSTONE_MS, ttl: ttl(DELETED_TOMBSTONE_MS + 60_000) } }),
      );
      let start: Record<string, unknown> | undefined;
      do {
        const out = await db.send(
          new QueryCommand({ TableName, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': user(sub) }, ProjectionExpression: 'pk, sk', ExclusiveStartKey: start }),
        );
        const keys = (out.Items ?? []).map((i) => ({ pk: i.pk, sk: i.sk }));
        for (let i = 0; i < keys.length; i += 25) {
          let pending = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
          for (let attempt = 0; pending.length; attempt++) {
            if (attempt === 6) throw new Error('Could not delete every item (throttled); try again');
            if (attempt) await new Promise((r) => setTimeout(r, 2 ** attempt * 50 + Math.random() * 50));
            const res = await db.send(new BatchWriteCommand({ RequestItems: { [TableName]: pending } }));
            pending = (res.UnprocessedItems?.[TableName] ?? []) as typeof pending;
          }
        }
        start = out.LastEvaluatedKey;
      } while (start);
    },
    async deletedRecently(sub) {
      // Strongly consistent: a tombstone written by another task a moment ago counts. TTL deletes lazily, so `until` decides.
      const out = await db.send(new GetCommand({ TableName, Key: { pk: `DELETED#${sub}`, sk: 'TOMBSTONE' }, ConsistentRead: true }));
      return typeof out.Item?.until === 'number' && out.Item.until > now();
    },
  };
};
