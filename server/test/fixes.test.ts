import { readFileSync } from 'node:fs';
import { DescribeContinuousBackupsCommand, DynamoDBClient, UpdateContinuousBackupsCommand } from '@aws-sdk/client-dynamodb';
import {
  DescribeSecurityGroupRulesCommand,
  EC2Client,
  EnableEbsEncryptionByDefaultCommand,
  GetEbsEncryptionByDefaultCommand,
  ModifyInstanceMetadataOptionsCommand,
  RevokeSecurityGroupIngressCommand,
} from '@aws-sdk/client-ec2';
import { GetPublicAccessBlockCommand, PutPublicAccessBlockCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXES, PartialFix } from '../src/agents/fixes.js';
import { RULES } from '../src/agents/findings.js';
import type { AwsClients } from '../src/aws.js';
import type { CityFinding } from '../src/world.js';

const ec2 = mockClient(EC2Client);
const s3 = mockClient(S3Client);
const dynamodb = mockClient(DynamoDBClient);
const clients = { ec2: new EC2Client({}), s3: new S3Client({}), dynamodb: new DynamoDBClient({}) } as unknown as AwsClients;
const CTX = { accountId: '123456789012' };
const finding = (id: string, fixId: string) => ({ id: 'f-1', resource: { id, name: id, gameOwned: true }, fix: { fixId } }) as unknown as CityFinding;

beforeEach(() => {
  ec2.reset();
  s3.reset();
  dynamodb.reset();
});

describe('the citizens’ fixes', () => {
  it('every fixable rule has exactly one fix, and every fix belongs to a rule', () => {
    const ids = RULES.flatMap((r) => (r.fix ? [r.fix.fixId] : []));
    expect(ids.sort()).toEqual(Object.keys(FIXES).sort());
  });

  it('only tightens: no delete, terminate, disable or authorize calls anywhere in fixes.ts', () => {
    const src = readFileSync(new URL('../src/agents/fixes.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\b(Delete|Terminate|Disable|Authorize)\w*Command/);
    expect(src).not.toMatch(/HttpTokens: 'optional'|PointInTimeRecoveryEnabled: false|: false \}/);
  });

  it('Block Public Access: all four settings on; already-on buckets are left alone', async () => {
    s3.on(GetPublicAccessBlockCommand).rejects(Object.assign(new Error('none'), { name: 'NoSuchPublicAccessBlockConfiguration' }));
    expect(await FIXES.s3_block_public_access!.stillOpen(clients, finding('b1', 's3_block_public_access'), CTX)).toBe(true);
    await FIXES.s3_block_public_access!.apply(clients, finding('b1', 's3_block_public_access'), CTX);
    expect(s3.commandCalls(PutPublicAccessBlockCommand)[0]!.args[0].input).toEqual({
      Bucket: 'b1',
      ExpectedBucketOwner: '123456789012',
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
    });
    s3.on(GetPublicAccessBlockCommand).resolves({ PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } });
    expect(await FIXES.s3_block_public_access!.stillOpen(clients, finding('b1', 's3_block_public_access'), CTX)).toBe(false);
  });

  it('closes only SSH/RDP rules open to the world, by rule id', async () => {
    ec2.on(DescribeSecurityGroupRulesCommand).resolves({
      SecurityGroupRules: [
        { SecurityGroupRuleId: 'sgr-ssh', IsEgress: false, IpProtocol: 'tcp', FromPort: 22, ToPort: 22, CidrIpv4: '0.0.0.0/0' },
        { SecurityGroupRuleId: 'sgr-web', IsEgress: false, IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIpv4: '0.0.0.0/0' },
        { SecurityGroupRuleId: 'sgr-mine', IsEgress: false, IpProtocol: 'tcp', FromPort: 22, ToPort: 22, CidrIpv4: '203.0.113.7/32' },
        { SecurityGroupRuleId: 'sgr-rdp6', IsEgress: false, IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389, CidrIpv6: '::/0' },
        { SecurityGroupRuleId: 'sgr-out', IsEgress: true, IpProtocol: '-1', CidrIpv4: '0.0.0.0/0' },
      ],
    });
    await FIXES.sg_revoke_world_admin!.apply(clients, finding('sg-1', 'sg_revoke_world_admin'), CTX);
    expect(ec2.commandCalls(RevokeSecurityGroupIngressCommand)[0]!.args[0].input).toEqual({ GroupId: 'sg-1', SecurityGroupRuleIds: ['sgr-ssh', 'sgr-rdp6'] });
  });

  it("leaves a rule that opens all traffic or a wide range to the player (it would close other ports too)", async () => {
    ec2.on(DescribeSecurityGroupRulesCommand).resolves({
      SecurityGroupRules: [
        { SecurityGroupRuleId: 'sgr-ssh', IsEgress: false, IpProtocol: 'tcp', FromPort: 22, ToPort: 22, CidrIpv4: '0.0.0.0/0' },
        { SecurityGroupRuleId: 'sgr-all', IsEgress: false, IpProtocol: '-1', CidrIpv4: '0.0.0.0/0' },
        { SecurityGroupRuleId: 'sgr-range', IsEgress: false, IpProtocol: 'tcp', FromPort: 0, ToPort: 1024, CidrIpv4: '0.0.0.0/0' },
      ],
    });
    expect(await FIXES.sg_revoke_world_admin!.plan!(clients, finding('sg-2', 'sg_revoke_world_admin'), CTX)).toMatchObject({ ok: true, detail: [expect.stringContaining('sgr-ssh'), expect.stringContaining('sgr-all, sgr-range')] });
    await expect(FIXES.sg_revoke_world_admin!.apply(clients, finding('sg-2', 'sg_revoke_world_admin'), CTX)).rejects.toThrow(PartialFix);
    expect(ec2.commandCalls(RevokeSecurityGroupIngressCommand)[0]!.args[0].input).toEqual({ GroupId: 'sg-2', SecurityGroupRuleIds: ['sgr-ssh'] });
  });

  it('revokes only the rule ids the player approved, not one added while the card was open', async () => {
    ec2.on(DescribeSecurityGroupRulesCommand).resolves({
      SecurityGroupRules: [
        { SecurityGroupRuleId: 'sgr-seen', IsEgress: false, IpProtocol: 'tcp', FromPort: 22, ToPort: 22, CidrIpv4: '0.0.0.0/0' },
        { SecurityGroupRuleId: 'sgr-new', IsEgress: false, IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389, CidrIpv4: '0.0.0.0/0' },
      ],
    });
    await FIXES.sg_revoke_world_admin!.apply(clients, finding('sg-4', 'sg_revoke_world_admin'), CTX, ['sgr-seen']);
    expect(ec2.commandCalls(RevokeSecurityGroupIngressCommand)[0]!.args[0].input).toEqual({ GroupId: 'sg-4', SecurityGroupRuleIds: ['sgr-seen'] });
  });

  it('offers no approval when the only open rules are broad ones', async () => {
    ec2.on(DescribeSecurityGroupRulesCommand).resolves({ SecurityGroupRules: [{ SecurityGroupRuleId: 'sgr-all', IsEgress: false, IpProtocol: '-1', CidrIpv4: '0.0.0.0/0' }] });
    expect(await FIXES.sg_revoke_world_admin!.plan!(clients, finding('sg-3', 'sg_revoke_world_admin'), CTX)).toMatchObject({ ok: false, reason: expect.stringContaining('Edit inbound rules') });
  });

  it('IMDSv2, EBS default encryption and PITR each send one tightening call', async () => {
    await FIXES.ec2_require_imdsv2!.apply(clients, finding('i-1', 'ec2_require_imdsv2'), CTX);
    expect(ec2.commandCalls(ModifyInstanceMetadataOptionsCommand)[0]!.args[0].input).toEqual({ InstanceId: 'i-1', HttpTokens: 'required' });
    ec2.on(GetEbsEncryptionByDefaultCommand).resolves({ EbsEncryptionByDefault: true });
    expect(await FIXES.ebs_default_encryption!.stillOpen(clients, finding('x', 'ebs_default_encryption'), CTX)).toBe(false);
    await FIXES.ebs_default_encryption!.apply(clients, finding('x', 'ebs_default_encryption'), CTX);
    expect(ec2.commandCalls(EnableEbsEncryptionByDefaultCommand)).toHaveLength(1);
    dynamodb.on(DescribeContinuousBackupsCommand).resolves({ ContinuousBackupsDescription: { ContinuousBackupsStatus: 'ENABLED', PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'DISABLED' } } });
    expect(await FIXES.dynamodb_enable_pitr!.stillOpen(clients, finding('city-t', 'dynamodb_enable_pitr'), CTX)).toBe(true);
    await FIXES.dynamodb_enable_pitr!.apply(clients, finding('city-t', 'dynamodb_enable_pitr'), CTX);
    expect(dynamodb.commandCalls(UpdateContinuousBackupsCommand)[0]!.args[0].input).toEqual({ TableName: 'city-t', PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } });
  });
});
