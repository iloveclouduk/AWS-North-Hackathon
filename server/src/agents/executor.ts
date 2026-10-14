import { randomBytes } from 'node:crypto';
import { reviewWorld, scorecardText } from './wellarchitected.js';
import { CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DescribeImagesCommand,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import { type BucketLocationConstraint, CreateBucketCommand, DeleteBucketCommand, PutBucketTaggingCommand } from '@aws-sdk/client-s3';
import { type AwsClients, classifyAwsError } from '../aws.js';
import { log, publicErrors } from '../log.js';
import { bucketPrefix, GAME_TAG, type WorldSnapshot } from '../state/model.js';
import { LockLostError } from '../store/types.js';
import type { Action } from './actions.js';

export interface ExecutionResult {
  ok: boolean;
  message: string;
  resourceId?: string;
  data?: unknown;
}

/** AMI ids are regional (and players pick their own region): cache per region. */
const cachedAmi = new Map<string, string>();

/** Amazon Linux 2023 AMIs boot from /dev/xvda. */
const AL2023_ROOT_DEVICE = '/dev/xvda';

/** Latest Amazon Linux 2023 ARM64 AMI (same filter as aws-backend's Terraform). */
const latestAl2023Arm64 = async ({ ec2 }: AwsClients): Promise<string> => {
  const region = await ec2.config.region();
  const hit = cachedAmi.get(region);
  if (hit) return hit;
  const { Images = [] } = await ec2.send(
    new DescribeImagesCommand({
      Owners: ['amazon'],
      Filters: [
        { Name: 'name', Values: ['al2023-ami-2023.*-kernel-*-arm64'] },
        { Name: 'architecture', Values: ['arm64'] },
        { Name: 'virtualization-type', Values: ['hvm'] },
        { Name: 'state', Values: ['available'] },
      ],
    }),
  );
  const newest = Images.filter((i) => i.ImageId && i.CreationDate).sort((a, b) => b.CreationDate!.localeCompare(a.CreationDate!))[0];
  if (!newest?.ImageId) throw new Error('No Amazon Linux 2023 arm64 AMI found');
  cachedAmi.set(region, newest.ImageId);
  return newest.ImageId;
};

const gameTags = (name: string) => [
  { Key: 'Name', Value: name },
  { Key: GAME_TAG.key, Value: GAME_TAG.value },
];

/**
 * Performs an Action that has already been parsed and approved by policy. `lease` is the account lock's: each AWS
 * write checks it first, so a change whose lock was lost stops before its next write.
 */
export const executeAction = async (action: Action, clients: AwsClients, snapshot: WorldSnapshot, region: string, lease?: AbortSignal): Promise<ExecutionResult> => {
  const held = () => lease?.throwIfAborted();
  try {
    switch (action.type) {
      case 'describe_resource': {
        const r = snapshot.resources.find((x) => x.id === action.id);
        return r ? { ok: true, message: `Details for ${r.name}`, resourceId: r.id, data: r } : { ok: false, message: `No resource "${action.id}" in the city.` };
      }

      case 'review_architecture': {
        const card = reviewWorld(snapshot);
        return { ok: true, message: scorecardText(card), data: card };
      }

      case 'launch_instance': {
        const ImageId = await latestAl2023Arm64(clients);
        held();
        const res = await clients.ec2.send(
          new RunInstancesCommand({
            ImageId,
            InstanceType: action.instanceType,
            MinCount: 1,
            MaxCount: 1,
            MetadataOptions: { HttpTokens: 'required' },
            // Encrypted root volume (AWS-managed EBS key, no extra cost); the player role requires it.
            BlockDeviceMappings: [{ DeviceName: AL2023_ROOT_DEVICE, Ebs: { Encrypted: true } }],
            // T4g defaults to "unlimited" credits, which can bill surplus CPU credits (Agent Toolkit for AWS, aws-compute).
            CreditSpecification: { CpuCredits: 'standard' },
            TagSpecifications: [
              { ResourceType: 'instance', Tags: gameTags(action.name) },
              { ResourceType: 'volume', Tags: gameTags(action.name) },
            ],
          }),
        );
        const id = res.Instances?.[0]?.InstanceId;
        return { ok: true, message: `Launching ${action.instanceType} "${action.name}" (${id}).`, resourceId: id };
      }

      case 'stop_instance':
        held();
        await clients.ec2.send(new StopInstancesCommand({ InstanceIds: [action.instanceId] }));
        return { ok: true, message: `Stopping ${action.instanceId}.`, resourceId: action.instanceId };

      case 'start_instance':
        held();
        await clients.ec2.send(new StartInstancesCommand({ InstanceIds: [action.instanceId] }));
        return { ok: true, message: `Starting ${action.instanceId}.`, resourceId: action.instanceId };

      case 'terminate_instance':
        held();
        await clients.ec2.send(new TerminateInstancesCommand({ InstanceIds: [action.instanceId] }));
        return { ok: true, message: `Terminating ${action.instanceId}.`, resourceId: action.instanceId };

      case 'create_table':
        held();
        await clients.dynamodb.send(
          new CreateTableCommand({
            TableName: action.name,
            AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
            KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
            BillingMode: 'PAY_PER_REQUEST',
            Tags: [{ Key: GAME_TAG.key, Value: GAME_TAG.value }],
          }),
        );
        return { ok: true, message: `Creating table "${action.name}".`, resourceId: action.name };

      case 'delete_table':
        held();
        await clients.dynamodb.send(new DeleteTableCommand({ TableName: action.name }));
        return { ok: true, message: `Deleting table "${action.name}".`, resourceId: action.name };

      case 'create_bucket': {
        const name = bucketPrefix(snapshot.accountId) + action.suffix;
        held();
        await clients.s3.send(
          new CreateBucketCommand({
            Bucket: name,
            // us-east-1 is the one region that rejects an explicit LocationConstraint.
            ...(region === 'us-east-1' ? {} : { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }),
          }),
        );
        held();
        await clients.s3.send(new PutBucketTaggingCommand({ Bucket: name, Tagging: { TagSet: [{ Key: GAME_TAG.key, Value: GAME_TAG.value }] } }));
        return { ok: true, message: `Created bucket "${name}".`, resourceId: name };
      }

      case 'delete_bucket':
        held();
        await clients.s3.send(new DeleteBucketCommand({ Bucket: action.name }));
        return { ok: true, message: `Deleted bucket "${action.name}".`, resourceId: action.name };
    }
  } catch (err) {
    if (err instanceof LockLostError) return { ok: false, message: err.message };
    return { ok: false, message: awsFailure(err) };
  }
};

/** Common AWS errors in one plain sentence (the error name is kept: it's safe and the model can act on it). */
const SAFE_AWS_TEXT: Record<string, string> = {
  BucketAlreadyExists: 'that bucket name is taken.',
  BucketAlreadyOwnedByYou: 'that bucket already exists in this account.',
  BucketNotEmpty: 'the bucket still has objects in it.',
  NoSuchBucket: 'no such bucket.',
  ResourceInUseException: 'that table already exists or is busy.',
  ResourceNotFoundException: 'no such table.',
  'InvalidInstanceID.NotFound': 'no such instance.',
  IncorrectInstanceState: 'the instance is not in a state that allows this.',
  InsufficientInstanceCapacity: 'AWS has no capacity for that instance type right now.',
  LimitExceededException: 'an AWS limit was reached.',
  InstanceLimitExceeded: 'an AWS limit was reached.',
  VcpuLimitExceeded: 'an AWS limit was reached.',
  TooManyBuckets: 'an AWS limit was reached.',
};

/**
 * What a failed AWS call tells the model and the player. Public (hosted): the error name and a plain sentence, the
 * full text only in the log with a ref (AWS messages carry account ids and role ARNs). Local: the real message.
 */
export const awsFailure = (err: unknown): string => {
  const e = err as { name?: string; message?: string };
  const name = String(e?.name ?? 'Error').replace(/[^\w.:-]/g, '').slice(0, 64) || 'Error';
  const kind = classifyAwsError(err);
  if (!publicErrors()) return (kind === 'denied' ? 'AWS denied this (IAM): ' : `AWS error (${name}): `) + (e?.message ?? '');
  const ref = randomBytes(3).toString('hex');
  log.warn('aws action failed', { ref, err: name, detail: e?.message?.slice(0, 300) });
  if (kind === 'denied') return `AWS denied this (${name}): the player role doesn't allow that.`;
  if (kind === 'expired') return `AWS error (${name}): the city's access to your account expired. Try again.`;
  return `AWS error (${name}): ${SAFE_AWS_TEXT[name] ?? `that didn't work (ref ${ref}).`}`;
};
