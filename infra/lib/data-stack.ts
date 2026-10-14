import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { ack, nagAccount } from './nag.js';
import type { Construct } from 'constructs';
import { type EnvConfig, extensionOrigins, playerRolePrefix, taskRoleName } from './config.js';

const PLAYER_ROLE_TEMPLATE = readFileSync(new URL('../player-role/player-role.yaml', import.meta.url), 'utf8');

/** The template's own version: the trailing `vN` of its Description (the one place it is set). */
export const playerRoleTemplateVersion = (template = PLAYER_ROLE_TEMPLATE) => {
  const v = /^Description:.*\bv(\d+)\s*$/m.exec(template)?.[1];
  if (!v) throw new Error('infra/player-role/player-role.yaml: the Description must end with the template version, e.g. "v3"');
  return Number(v);
};

/** Each version gets its own key, so a setup link handed out earlier keeps fetching the template it was made for. */
export const PLAYER_ROLE_KEY = `player-role/v${playerRoleTemplateVersion()}.yaml`;

/**
 * Durable state: the single table (server/src/store/dynamo.ts), the private screenshots bucket
 * (1-day expiry), and the public templates bucket that serves the player-role quick-create template.
 */
export class DataStack extends Stack {
  readonly table: dynamodb.TableV2;
  readonly screenshots: s3.Bucket;
  readonly playerRoleTemplateUrl: string;
  /** Safari sign-in relay page (static, no scripts); Cognito redirects there and the extension reads the URL. */
  readonly authRelayUrl: string;

  constructor(scope: Construct, id: string, env: EnvConfig, props?: StackProps) {
    super(scope, id, props);

    // The table holds each player's ExternalId (the secret their role's trust needs): a key we control,
    // rotated yearly, whose use shows up in CloudTrail.
    const tableKey = new kms.Key(this, 'TableKey', {
      alias: `alias/aws-city-${env.name}-table`,
      description: 'AWS City player table (progress, account links, ExternalIds)',
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.table = new dynamodb.TableV2(this, 'Table', {
      encryption: dynamodb.TableEncryptionV2.customerManagedKey(tableKey),
      tableName: `aws-city-${env.name}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // PITR covers the last 35 days to the second; AWS Backup adds a daily snapshot, also kept 35 days, that
    // survives a deleted table or a bad restore. Nothing outlives 35 days, so a deleted player is gone from every
    // copy within that window (docs/privacy-policy.md). docs/runbook.md has the restore steps.
    const plan = new backup.BackupPlan(this, 'TableBackup', {
      backupPlanRules: [
        new backup.BackupPlanRule({
          ruleName: 'Daily35Days',
          scheduleExpression: events.Schedule.cron({ hour: '5', minute: '0' }),
          deleteAfter: Duration.days(35),
        }),
      ],
    });
    const selection = plan.addSelection('Table', { resources: [backup.BackupResource.fromArn(this.table.tableArn)] });
    ack(selection, [
      {
        id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup]',
        reason: 'The AWS Backup service role with the AWS-maintained backup policy (the documented setup); it only backs up the selected table.',
      },
    ]);

    const logs = new s3.Bucket(this, 'AccessLogs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const origins = extensionOrigins(env);
    this.screenshots = new s3.Bucket(this, 'Screenshots', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: logs,
      serverAccessLogsPrefix: 'screenshots/',
      // Screenshots are only needed for one Lookout answer.
      lifecycleRules: [{ expiration: Duration.days(1), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      // Presigned POST straight from the extension.
      cors: origins.length ? [{ allowedMethods: [s3.HttpMethods.POST], allowedOrigins: origins, allowedHeaders: ['*'], maxAge: 600 }] : undefined,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // CloudFormation quick-create must be able to fetch the template: public read on player-role/* only.
    const templates = new s3.Bucket(this, 'Templates', {
      blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: false, restrictPublicBuckets: false }),
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      // Old template versions keep their own keys (PLAYER_ROLE_KEY) and are never expired; this only drops
      // overwritten copies of one version (a re-publish, e.g. a changed task role name) after 90 days.
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(90) }],
      serverAccessLogsBucket: logs,
      serverAccessLogsPrefix: 'templates/',
      removalPolicy: RemovalPolicy.RETAIN,
    });
    templates.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        principals: [new iam.AnyPrincipal()],
        resources: [templates.arnForObjects('player-role/*'), templates.arnForObjects('auth/*')],
      }),
    );
    // Our account id is written into the published template, so a setup link can't be edited to trust anyone else.
    const template = PLAYER_ROLE_TEMPLATE.replaceAll('__AWS_CITY_ACCOUNT_ID__', this.account)
      .replaceAll('__AWS_CITY_TASK_ROLE__', taskRoleName(env))
      .replaceAll('__AWS_CITY_PLAYER_ROLE__', playerRolePrefix(env));
    new s3deploy.BucketDeployment(this, 'PublishPlayerRole', {
      destinationBucket: templates,
      sources: [s3deploy.Source.data(PLAYER_ROLE_KEY, template)],
      // Publishes player-role/v<N>.yaml only. prune: false keeps the earlier v<M>.yaml keys (and retainOnDelete keeps
      // everything if this resource goes), so a setup link made before a template change still works.
      prune: false,
      contentType: 'text/yaml',
    });
    this.playerRoleTemplateUrl = `https://${templates.bucketRegionalDomainName}/${PLAYER_ROLE_KEY}`;
    new s3deploy.BucketDeployment(this, 'PublishAuthRelay', {
      destinationBucket: templates,
      destinationKeyPrefix: 'auth/',
      sources: [s3deploy.Source.asset(fileURLToPath(new URL('../auth-relay', import.meta.url)))],
      prune: false,
      contentType: 'text/html; charset=utf-8',
    });
    this.authRelayUrl = `https://${templates.bucketRegionalDomainName}/auth/callback.html`;
    new CfnOutput(this, 'AuthRelayUrl', { value: this.authRelayUrl });
    new CfnOutput(this, 'PlayerRoleTemplateUrl', { value: this.playerRoleTemplateUrl });

    ack(templates, [
      {
        id: 'AwsSolutions::AwsSolutions-S2',
        reason: "Public read of player-role/* (CloudFormation quick-create in players' accounts) and auth/* (the static Safari sign-in relay page) only; ACLs stay blocked.",
      },
    ]);
    // CDK's one BucketDeployment handler per stack (shared by both deployments above): acknowledged on it only.
    const deployer = this.node.children.find((c) => c.node.id.startsWith('Custom::CDKBucketDeployment'));
    if (!deployer) throw new Error('BucketDeployment handler not found: update the cdk-nag acknowledgements below');
    const IAM5 = 'AwsSolutions-IAM5';
    ack(deployer, [
      ...['s3:Abort*', 's3:DeleteObject*', 's3:GetBucket*', 's3:GetObject*', 's3:List*'].map((a) => ({ id: `${IAM5}[Action::${a}]`, reason: "CDK's BucketDeployment handler copies the template and relay page from the asset bucket into the templates bucket (CDK's grant)." })),
      { id: `${IAM5}[Resource::<${this.getLogicalId(templates.node.defaultChild as s3.CfnBucket)}.Arn>/*]`, reason: "CDK's BucketDeployment handler writes objects into the templates bucket only." },
      { id: `${IAM5}[Resource::arn:<AWS::Partition>:s3:::cdk-hnb659fds-assets-${nagAccount(this.account)}-${env.region}/*]`, reason: 'The CDK bootstrap asset bucket the handler reads the sources from.' },
      { id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]', reason: "The BucketDeployment handler's own CloudWatch logging (AWS-managed basic execution role)." },
      { id: 'AwsSolutions::AwsSolutions-L1', reason: "The BucketDeployment handler's runtime is chosen and updated by CDK." },
    ]);
  }
}
