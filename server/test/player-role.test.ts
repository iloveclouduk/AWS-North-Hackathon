import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The player role (infra/player-role/player-role.yaml) must allow every AWS call the server makes for a
 * player, and nothing broad. Adding an SDK command without its IAM action fails here, not in production.
 */
const template = readFileSync(new URL('../../infra/player-role/player-role.yaml', import.meta.url), 'utf8');
const source = ['../src/state/poller.ts', '../src/state/inventory.ts', '../src/state/bill.ts', '../src/state/flow.ts', '../src/agents/executor.ts', '../src/agents/fixes.ts'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
/** The opt-in aws-city-fix policy (only created when AllowFixes=true). */
const fixPolicy = template.slice(template.indexOf('- FixesOn'), template.indexOf('- !Ref AWS::NoValue'));

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
  // the city's mirror and its Well-Architected checks (read-only)
  DescribeContinuousBackupsCommand: 'dynamodb:DescribeContinuousBackups',
  GetEbsEncryptionByDefaultCommand: 'ec2:GetEbsEncryptionByDefault',
  DescribeSecurityGroupRulesCommand: 'ec2:DescribeSecurityGroupRules',
  DescribeVolumesCommand: 'ec2:DescribeVolumes',
  GetPublicAccessBlockCommand: 's3:GetBucketPublicAccessBlock',
  GetAccountPublicAccessBlockCommand: 's3:GetAccountPublicAccessBlock',
  DescribeTrailsCommand: 'cloudtrail:DescribeTrails',
  GetTrailStatusCommand: 'cloudtrail:GetTrailStatus',
  ListEventDataStoresCommand: 'cloudtrail:ListEventDataStores',
  ListIndexesCommand: 'resource-explorer-2:ListIndexes',
  SearchCommand: 'resource-explorer-2:Search',
  GetResourcesCommand: 'tag:GetResources',
  // v2.5: the real AZ map and Region opt-ins, and the opt-in bill (read-only)
  DescribeAvailabilityZonesCommand: 'ec2:DescribeAvailabilityZones',
  DescribeRegionsCommand: 'ec2:DescribeRegions',
  GetCostAndUsageCommand: 'ce:GetCostAndUsage',
  GetMetricDataCommand: 'cloudwatch:GetMetricData',
  // the citizens' fixes (aws-city-fix, AllowFixes=true only)
  PutPublicAccessBlockCommand: 's3:PutBucketPublicAccessBlock',
  RevokeSecurityGroupIngressCommand: 'ec2:RevokeSecurityGroupIngress',
  ModifyInstanceMetadataOptionsCommand: 'ec2:ModifyInstanceMetadataOptions',
  EnableEbsEncryptionByDefaultCommand: 'ec2:EnableEbsEncryptionByDefault',
  UpdateContinuousBackupsCommand: 'dynamodb:UpdateContinuousBackups',
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
    // Encrypted volumes only, and the server asks for one (a launch would otherwise be denied).
    expect(template).toContain("'ec2:Encrypted': 'true'");
    expect(source).toMatch(/Ebs: \{ Encrypted: true \}/);
  });

  it('fixes are opt-in, match fixes.ts exactly, and can only tighten things', async () => {
    const { FIXES } = await import('../src/agents/fixes.js');
    expect(template).toMatch(/AllowFixes:\s*\n\s*Type: String\s*\n\s*Default: 'false'/);
    expect(template).toContain("FixesOn: !Equals [!Ref AllowFixes, 'true']");
    expect(fixPolicy).toContain('PolicyName: aws-city-fix');
    for (const def of Object.values(FIXES)) {
      expect(fixPolicy, `${def.iamAction} belongs in aws-city-fix`).toContain(def.iamAction);
      // ...and only there: no fix action is granted unconditionally.
      expect(template.replace(fixPolicy, ''), `${def.iamAction} outside aws-city-fix`).not.toContain(def.iamAction);
    }
    // IMDS changes are held to HttpTokens=required by IAM itself.
    expect(fixPolicy).toMatch(/ModifyInstanceMetadataOptions[\s\S]*?'ec2:Attribute\/HttpTokens': required/);
    // Nothing that could undo a fix by loosening a setting, anywhere in the role.
    for (const loosen of ['AuthorizeSecurityGroupIngress', 'DisableEbsEncryptionByDefault', 'DeleteBucketPublicAccessBlock', 'DeletePublicAccessBlock']) expect(template).not.toContain(loosen);
  });

  it('CloudWatch: GetMetricData only, in its own Region, and only the fixed queries flow.ts sends', async () => {
    const cw = template.match(/cloudwatch:[A-Za-z*]+/g) ?? [];
    expect([...new Set(cw)]).toEqual(['cloudwatch:GetMetricData']);
    expect(template).toMatch(/Sid: LiveTraffic[\s\S]*?Action: cloudwatch:GetMetricData[\s\S]*?'aws:RequestedRegion': !Ref 'AWS::Region'/);
    const { FLOW_QUERIES } = await import('../src/state/flow.js');
    for (const q of FLOW_QUERIES) expect(q.expression, q.id).toMatch(/^SELECT SUM\(/);
  });

  it('role name matches what account linking expects', async () => {
    const { playerRoleName } = await import('../src/accounts/link.js');
    expect(template).toContain('RoleName: !Sub __AWS_CITY_PLAYER_ROLE__-${AWS::Region}');
    expect(playerRoleName('eu-west-1')).toBe('AWSCityPlayerRole-eu-west-1');
    expect(playerRoleName('eu-west-1', 'AWSCityPlayerRole-staging')).toBe('AWSCityPlayerRole-staging-eu-west-1');
  });
});
