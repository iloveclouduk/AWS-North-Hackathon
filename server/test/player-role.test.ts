import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The player role (infra/player-role/player-role.yaml) must allow every AWS call the server makes for a
 * player, and nothing broad. Adding an SDK command without its IAM action fails here, not in production.
 */
const template = readFileSync(new URL('../../infra/player-role/player-role.yaml', import.meta.url), 'utf8');
const source = ['../src/state/poller.ts', '../src/agents/executor.ts'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');

const IAM_FOR: Record<string, string> = {
  DescribeInstancesCommand: 'ec2:DescribeInstances',
  DescribeSecurityGroupsCommand: 'ec2:DescribeSecurityGroups',
  DescribeImagesCommand: 'ec2:DescribeImages',
  RunInstancesCommand: 'ec2:RunInstances',
  StopInstancesCommand: 'ec2:StopInstances',
  StartInstancesCommand: 'ec2:StartInstances',
  TerminateInstancesCommand: 'ec2:TerminateInstances',
  ListTablesCommand: 'dynamodb:ListTables',
  DescribeTableCommand: 'dynamodb:DescribeTable',
  ListTagsOfResourceCommand: 'dynamodb:ListTagsOfResource',
  CreateTableCommand: 'dynamodb:CreateTable',
  DeleteTableCommand: 'dynamodb:DeleteTable',
  ListBucketsCommand: 's3:ListAllMyBuckets',
  CreateBucketCommand: 's3:CreateBucket',
  PutBucketTaggingCommand: 's3:PutBucketTagging',
  DeleteBucketCommand: 's3:DeleteBucket',
  ListFunctionsCommand: 'lambda:ListFunctions',
  DescribeDBInstancesCommand: 'rds:DescribeDBInstances',
  GetApisCommand: 'apigateway:GET',
};

describe('player role template', () => {
  it('allows every AWS call the server makes for a player', () => {
    const used = [...new Set([...source.matchAll(/new ([A-Z][A-Za-z0-9]+Command)\(/g)].map((m) => m[1]!))];
    expect(used.length).toBeGreaterThan(10);
    for (const cmd of used) {
      const action = IAM_FOR[cmd];
      expect(action, `${cmd} has no IAM mapping — add it here and to player-role.yaml`).toBeDefined();
      expect(template, `${action} missing from player-role.yaml`).toContain(action!);
    }
  });

  it('grants nothing broad: no wildcards actions, no IAM, no role passing', () => {
    expect(template).not.toMatch(/Action:\s*['"]?\*/);
    expect(template).not.toMatch(/Action:.*\b\w+:\*/);
    expect(template).not.toMatch(/\biam:[A-Za-z*]/); // no IAM actions (ARNs contain iam::)
    expect(template).not.toMatch(/PassRole/);
    // Trust needs both our role and the player's ExternalId.
    expect(template).toContain("'sts:ExternalId': !Ref ExternalId");
    expect(template).toContain("'aws:PrincipalArn': 'arn:aws:iam::__AWS_CITY_ACCOUNT_ID__:role/__AWS_CITY_TASK_ROLE__'");
    // The trusted account can't be a parameter: a crafted setup link could otherwise trust anyone.
    expect(template).not.toMatch(/Trusted\w*:\s*\n\s*Type:/);
    expect(template).not.toMatch(/\$\{Trusted/);
    // Tiny instances with IMDSv2 only.
    expect(template).toMatch(/'ec2:InstanceType': \[t4g.nano, t4g.micro\]/);
    expect(template).toContain("'ec2:MetadataHttpTokens': required");
  });

  it('role name matches what account linking expects', async () => {
    const { playerRoleName } = await import('../src/accounts/link.js');
    expect(template).toContain('RoleName: !Sub __AWS_CITY_PLAYER_ROLE__-${AWS::Region}');
    expect(playerRoleName('eu-west-1')).toBe('AWSCityPlayerRole-eu-west-1');
    expect(playerRoleName('eu-west-1', 'AWSCityPlayerRole-staging')).toBe('AWSCityPlayerRole-staging-eu-west-1');
  });
});
