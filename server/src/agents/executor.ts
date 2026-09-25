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
import { bucketPrefix, GAME_TAG, type WorldSnapshot } from '../state/model.js';
import type { Action } from './actions.js';

export interface ExecutionResult {
  ok: boolean;
  message: string;
  resourceId?: string;
  data?: unknown;
}

let cachedAmi: string | undefined;

/** Latest Amazon Linux 2023 ARM64 AMI (same filter as aws-backend's Terraform). */
const latestAl2023Arm64 = async ({ ec2 }: AwsClients): Promise<string> => {
  if (cachedAmi) return cachedAmi;
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
  return (cachedAmi = newest.ImageId);
};

const gameTags = (name: string) => [
  { Key: 'Name', Value: name },
  { Key: GAME_TAG.key, Value: GAME_TAG.value },
];

/** Performs an Action that has already been parsed and approved by policy. */
export const executeAction = async (action: Action, clients: AwsClients, snapshot: WorldSnapshot, region: string): Promise<ExecutionResult> => {
  try {
    switch (action.type) {
      case 'describe_resource': {
        const r = snapshot.resources.find((x) => x.id === action.id);
        return r ? { ok: true, message: `Details for ${r.name}`, resourceId: r.id, data: r } : { ok: false, message: `No resource "${action.id}" in the city.` };
      }

      case 'launch_instance': {
        const res = await clients.ec2.send(
          new RunInstancesCommand({
            ImageId: await latestAl2023Arm64(clients),
            InstanceType: action.instanceType,
            MinCount: 1,
            MaxCount: 1,
            MetadataOptions: { HttpTokens: 'required' },
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
        await clients.ec2.send(new StopInstancesCommand({ InstanceIds: [action.instanceId] }));
        return { ok: true, message: `Stopping ${action.instanceId}.`, resourceId: action.instanceId };

      case 'start_instance':
        await clients.ec2.send(new StartInstancesCommand({ InstanceIds: [action.instanceId] }));
        return { ok: true, message: `Starting ${action.instanceId}.`, resourceId: action.instanceId };

      case 'terminate_instance':
        await clients.ec2.send(new TerminateInstancesCommand({ InstanceIds: [action.instanceId] }));
        return { ok: true, message: `Terminating ${action.instanceId}.`, resourceId: action.instanceId };

      case 'create_table':
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
        await clients.dynamodb.send(new DeleteTableCommand({ TableName: action.name }));
        return { ok: true, message: `Deleting table "${action.name}".`, resourceId: action.name };

      case 'create_bucket': {
        const name = bucketPrefix(snapshot.accountId) + action.suffix;
        await clients.s3.send(
          new CreateBucketCommand({
            Bucket: name,
            // us-east-1 is the one region that rejects an explicit LocationConstraint.
            ...(region === 'us-east-1' ? {} : { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }),
          }),
        );
        await clients.s3.send(new PutBucketTaggingCommand({ Bucket: name, Tagging: { TagSet: [{ Key: GAME_TAG.key, Value: GAME_TAG.value }] } }));
        return { ok: true, message: `Created bucket "${name}".`, resourceId: name };
      }

      case 'delete_bucket':
        await clients.s3.send(new DeleteBucketCommand({ Bucket: action.name }));
        return { ok: true, message: `Deleted bucket "${action.name}".`, resourceId: action.name };
    }
  } catch (err) {
    const e = err as Error;
    const prefix = classifyAwsError(err) === 'denied' ? 'AWS denied this (IAM): ' : `AWS error (${e.name}): `;
    return { ok: false, message: prefix + e.message };
  }
};
