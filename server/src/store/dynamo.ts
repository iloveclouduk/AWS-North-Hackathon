import { randomUUID } from 'node:crypto';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ProgressSchema } from '../contract/progress.js';
import type { Resource } from '../state/model.js';
import type { Progress } from '../world.js';
import type { AccountLocks, AccountRecord, Stores } from './types.js';

/**
 * Single-table design (infra/lib/data-stack.ts):
 *   USER#<sub>    PROGRESS | ACCOUNT | QUOTA#<day>
 *   QUOTA#GLOBAL  <day>
 *   AWSACCT#<id>  LOCK | PENDING#<kind:id>
 * `ttl` (epoch seconds) expires quotas, locks and pending entries.
 */
const LEASE_MS = 30_000;
const isConditional = (err: unknown) => (err as { name?: string })?.name === 'ConditionalCheckFailedException';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ttl = (ms: number) => Math.floor((Date.now() + ms) / 1000);

export const dynamoStores = (deps: { client: DynamoDBClient; table: string; now?: () => number }): Stores => {
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
      try {
        return await fn();
      } finally {
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
    async deleteUser(sub) {
      const out = await db.send(new QueryCommand({ TableName, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': user(sub) }, ProjectionExpression: 'pk, sk' }));
      const keys = (out.Items ?? []).map((i) => ({ pk: i.pk, sk: i.sk }));
      for (let i = 0; i < keys.length; i += 25) {
        await db.send(new BatchWriteCommand({ RequestItems: { [TableName]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } }));
      }
    },
  };
};
