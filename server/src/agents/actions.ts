import { z } from 'zod';
import { TABLE_PREFIX } from '../state/model.js';

const instanceId = z.string().regex(/^i-[0-9a-f]{8,17}$/, 'must be an EC2 instance id like i-0123456789abcdef0');
const displayName = z.string().min(1).max(40).regex(/^[A-Za-z0-9 _-]+$/, 'letters, numbers, spaces, - and _ only');

/**
 * The single allowlist of AWS actions. Players (via the UI) and AI agents (via tools) both go through it.
 * `.strict()` rejects extra fields, so nothing like a region or instance-profile override can sneak in.
 */
export const ACTION_SCHEMAS = {
  launch_instance: z
    .object({ name: displayName, instanceType: z.enum(['t4g.nano', 't4g.micro']).default('t4g.micro') })
    .strict()
    .describe('Build a house: launch a small EC2 instance (t4g.nano or t4g.micro, Amazon Linux 2023).'),
  stop_instance: z.object({ instanceId }).strict().describe('Put a house to sleep: stop an EC2 instance built by the game.'),
  start_instance: z.object({ instanceId }).strict().describe('Wake a house up: start a stopped EC2 instance built by the game.'),
  terminate_instance: z
    .object({ instanceId })
    .strict()
    .describe('Demolish a house: permanently terminate an EC2 instance built by the game. The player must approve.'),
  create_table: z
    .object({ name: z.string().regex(new RegExp(`^${TABLE_PREFIX}[a-z0-9-]{1,40}$`), `must start with "${TABLE_PREFIX}", lowercase letters, digits and - only`) })
    .strict()
    .describe(`Build a library: create an on-demand DynamoDB table (name must start with "${TABLE_PREFIX}").`),
  delete_table: z
    .object({ name: z.string().startsWith(TABLE_PREFIX) })
    .strict()
    .describe('Demolish a library: delete a DynamoDB table built by the game, with all its items. The player must approve.'),
  create_bucket: z
    .object({ suffix: z.string().regex(/^[a-z0-9-]{3,20}$/, '3-20 lowercase letters, digits or -') })
    .strict()
    .describe('Build a warehouse: create an S3 bucket named aws-city-<account>-<suffix>.'),
  delete_bucket: z
    .object({ name: z.string().startsWith('aws-city-') })
    .strict()
    .describe('Demolish a warehouse: delete an empty S3 bucket built by the game. The player must approve.'),
  describe_resource: z
    .object({ id: z.string().min(1).max(255) })
    .strict()
    .describe('Look closely at any building: return the details AWS reports for one resource (read-only).'),
} as const;

export type ActionName = keyof typeof ACTION_SCHEMAS;
export type Action = { [K in ActionName]: { type: K } & z.infer<(typeof ACTION_SCHEMAS)[K]> }[ActionName];

export const DESTRUCTIVE: ReadonlySet<ActionName> = new Set(['terminate_instance', 'delete_table', 'delete_bucket']);
export const READ_ONLY: ReadonlySet<ActionName> = new Set(['describe_resource']);

export const isActionName = (name: string): name is ActionName => Object.hasOwn(ACTION_SCHEMAS, name);

export type ParseResult = { ok: true; action: Action } | { ok: false; error: string };

/** Parses untrusted input (a model's tool call or a player's POST body) into a validated Action. */
export const parseAction = (name: unknown, input: unknown): ParseResult => {
  if (typeof name !== 'string' || !isActionName(name)) return { ok: false, error: `Unknown action "${String(name)}".` };
  const parsed = ACTION_SCHEMAS[name].safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') };
  }
  return { ok: true, action: { type: name, ...parsed.data } as Action };
};

/** Which city agent (taxonomy service id) may use each action, and which AWS service it calls. */
export const ACTION_SERVICE: Record<ActionName, string | null> = {
  launch_instance: 'ec2',
  stop_instance: 'ec2',
  start_instance: 'ec2',
  terminate_instance: 'ec2',
  create_table: 'dynamodb',
  delete_table: 'dynamodb',
  create_bucket: 's3',
  delete_bucket: 's3',
  describe_resource: null, // read-only, any agent
};

/** The AWS API name shown on the agent's name tag while the call runs. */
export const AWS_API: Record<ActionName, string> = {
  launch_instance: 'ec2:RunInstances',
  stop_instance: 'ec2:StopInstances',
  start_instance: 'ec2:StartInstances',
  terminate_instance: 'ec2:TerminateInstances',
  create_table: 'dynamodb:CreateTable',
  delete_table: 'dynamodb:DeleteTable',
  create_bucket: 's3:CreateBucket',
  delete_bucket: 's3:DeleteBucket',
  describe_resource: 'city:DescribeResource',
};

/** Actions an agent may use: its own service's actions plus read-only ones (least privilege per agent). */
export const actionsForAgent = (agentId: string): ActionName[] =>
  (Object.keys(ACTION_SCHEMAS) as ActionName[]).filter((name) => ACTION_SERVICE[name] === null || ACTION_SERVICE[name] === agentId);

/** Tool definitions for the model, generated from the same schemas that validate the calls. */
export const toolDefinitions = (names: ActionName[] = Object.keys(ACTION_SCHEMAS) as ActionName[]) =>
  names.map((name) => {
    const schema = ACTION_SCHEMAS[name];
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
    return {
      name,
      description: schema.description ?? name,
      input_schema: { ...inputSchema, type: 'object' as const },
    };
  });
