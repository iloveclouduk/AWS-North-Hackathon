import { readFileSync } from 'node:fs';
import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { ack, nagAccount } from './nag.js';
import type { Construct } from 'constructs';
import type { EnvConfig } from './config.js';

export const PLAYER_ROLE_KEY = 'player-role/v1.yaml';

/**
 * Durable state: the single table (server/src/store/dynamo.ts), the private screenshots bucket
 * (1-day expiry), and the public templates bucket that serves the player-role quick-create template.
 */
export class DataStack extends Stack {
  readonly table: dynamodb.TableV2;
  readonly screenshots: s3.Bucket;
  readonly playerRoleTemplateUrl: string;

  constructor(scope: Construct, id: string, env: EnvConfig, props?: StackProps) {
    super(scope, id, props);

    this.table = new dynamodb.TableV2(this, 'Table', {
      tableName: `aws-city-${env.name}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const logs = new s3.Bucket(this, 'AccessLogs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const origins = env.extensionIds.map((id) => `chrome-extension://${id}`);
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
      serverAccessLogsBucket: logs,
      serverAccessLogsPrefix: 'templates/',
      removalPolicy: RemovalPolicy.RETAIN,
    });
    templates.addToResourcePolicy(
      new iam.PolicyStatement({ actions: ['s3:GetObject'], principals: [new iam.AnyPrincipal()], resources: [templates.arnForObjects('player-role/*')] }),
    );
    // Our account id is written into the published template, so a setup link can't be edited to trust anyone else.
    const template = readFileSync(new URL('../player-role/player-role.yaml', import.meta.url), 'utf8').replaceAll('__AWS_CITY_ACCOUNT_ID__', this.account);
    new s3deploy.BucketDeployment(this, 'PublishPlayerRole', {
      destinationBucket: templates,
      sources: [s3deploy.Source.data(PLAYER_ROLE_KEY, template)],
      prune: false, // older versions stay so old setup links keep working
      contentType: 'text/yaml',
    });
    this.playerRoleTemplateUrl = `https://${templates.bucketRegionalDomainName}/${PLAYER_ROLE_KEY}`;

    ack(templates, [{ id: 'AwsSolutions::AwsSolutions-S2', reason: "Public read of player-role/* is required for CloudFormation quick-create in players' accounts (ACLs stay blocked)." }]);
    const IAM5 = 'AwsSolutions-IAM5';
    ack(this, [
      ...['s3:Abort*', 's3:DeleteObject*', 's3:GetBucket*', 's3:GetObject*', 's3:List*'].map((a) => ({ id: `${IAM5}[Action::${a}]`, reason: "CDK's BucketDeployment helper Lambda copies into the templates bucket." })),
      { id: `${IAM5}[Resource::<Templates785E9C36.Arn>/*]`, reason: "CDK's BucketDeployment helper writes template objects." },
      { id: `${IAM5}[Resource::arn:<AWS::Partition>:s3:::cdk-hnb659fds-assets-${nagAccount(this.account)}-${env.region}/*]`, reason: 'CDK bootstrap asset bucket (read by the deployment helper).' },
      { id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]', reason: "CDK's BucketDeployment helper Lambda logging." },
      { id: 'AwsSolutions::AwsSolutions-L1', reason: "The BucketDeployment helper's runtime is chosen and updated by CDK." },
    ]);
  }
}
