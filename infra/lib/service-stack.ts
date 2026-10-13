import { fileURLToPath } from 'node:url';
import { Annotations, CfnOutput, type CfnResource, Duration, IgnoreMode, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cfOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import { ContainerImageBuild } from '@cdklabs/deploy-time-build';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { ack, nagAccount } from './nag.js';
import { logWaf, visibility, wafRules } from './waf.js';
import type { Construct } from 'constructs';
import { type EnvConfig, extensionOrigins, playerRolePrefix, taskRoleName } from './config.js';
import { foundationModel } from './models.js';

export interface ServiceDeps {
  /** CloudFront-scope WAF from EdgeStack (us-east-1), used when there's no custom domain. */
  edgeWebAclArn?: string;
  table: dynamodb.TableV2;
  screenshots: s3.Bucket;
  playerRoleTemplateUrl: string;
  userPool: cognito.UserPool;
  client: cognito.UserPoolClient;
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The server on ECS Fargate (ARM64) behind an ALB. WebSockets need long-lived connections and the
 * agent loops wait on player approvals, so this is a container service, not Lambda/API Gateway.
 * Per-socket state stays in the task; shared state is in DynamoDB/S3, so no sticky sessions.
 */
export class ServiceStack extends Stack {
  readonly taskRole: iam.Role;
  readonly killSwitch: ssm.StringParameter;

  constructor(scope: Construct, id: string, env: EnvConfig, deps: ServiceDeps, props?: StackProps) {
    super(scope, id, props);

    // Players pick any region for their own account, so tasks need internet egress: public subnets with
    // a public IP (no NAT cost) and a security group that only accepts the load balancer.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      // Explicit AZs: no account lookup needed at synth time (CI synthesises without credentials).
      availabilityZones: [`${env.region}a`, `${env.region}b`],
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        // For the internal load balancer behind CloudFront VPC origins (no route to the internet).
        { name: 'alb', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 }, DynamoDB: { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB } },
      flowLogs: {
        rejected: {
          trafficType: ec2.FlowLogTrafficType.REJECT,
          destination: ec2.FlowLogDestination.toCloudWatchLogs(new logs.LogGroup(this, 'FlowLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY })),
        },
      },
    });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });

    this.killSwitch = new ssm.StringParameter(this, 'AiEnabled', {
      parameterName: `/aws-city/${env.name}/ai-enabled`,
      stringValue: 'true',
      description: 'Set to "false" to switch every AI call off within ~30 s (manual kill switch).',
    });

    // Fixed name + retained: every player's AWSCityPlayerRole trusts exactly this role.
    this.taskRole = new iam.Role(this, 'TaskRole', {
      roleName: taskRoleName(env),
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: "AWS City server: Bedrock, its own table and bucket, and assuming players' AWSCityPlayerRole.",
    });
    this.taskRole.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const models = [env.models.main, env.models.light];
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'Bedrock',
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          ...models.map((m) => `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${m}`),
          // A geo inference profile (us./eu./au./in., lib/models.ts) routes to the foundation model in that geography's Regions.
          ...models.map((m) => `arn:aws:bedrock:*::foundation-model/${foundationModel(m)}*`),
        ],
      }),
    );
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumePlayerRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::*:role/${playerRolePrefix(env)}-*`],
        // Never a role in our own account, even if someone creates one with that name here.
        conditions: { StringNotEquals: { 'aws:ResourceAccount': this.account } },
      }),
    );
    deps.table.grantReadWriteData(this.taskRole);
    // Presigned POST is signed by this role (PutObject); the Lookout reads the player's own upload (GetObject).
    this.taskRole.addToPolicy(new iam.PolicyStatement({ sid: 'Screenshots', actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'], resources: [deps.screenshots.arnForObjects('screenshots/*')] }));
    // DELETE /me lists the player's folder to remove their screenshots.
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({ sid: 'ListScreenshots', actions: ['s3:ListBucket'], resources: [deps.screenshots.bucketArn], conditions: { StringLike: { 's3:prefix': 'screenshots/*' } } }),
    );
    this.killSwitch.grantRead(this.taskRole);
    this.taskRole.addToPolicy(new iam.PolicyStatement({ sid: 'DeletePlayer', actions: ['cognito-idp:AdminDeleteUser'], resources: [deps.userPool.userPoolArn] }));
    // Step-up check before linking an AWS account: has this player turned MFA on?
    this.taskRole.addToPolicy(new iam.PolicyStatement({ sid: 'CheckPlayerMfa', actions: ['cognito-idp:AdminGetUser'], resources: [deps.userPool.userPoolArn] }));

    const logGroup = new logs.LogGroup(this, 'Logs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole: this.taskRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    // Two ways in:
    //  - a custom domain (Route 53 zone given): a public HTTPS load balancer at api.<domain>;
    //  - no domain: CloudFront (free https://xxxx.cloudfront.net, WebSockets supported) in front of an
    //    INTERNAL load balancer through a CloudFront VPC origin, so nothing is exposed to the internet.
    const https = Boolean(env.domainName && env.hostedZoneId && env.zoneName);
    const zone = https ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId: env.hostedZoneId, zoneName: env.zoneName }) : undefined;
    const certificate = zone ? new acm.Certificate(this, 'Cert', { domainName: env.domainName, validation: acm.CertificateValidation.fromDns(zone) }) : undefined;
    let internalAlb: elbv2.ApplicationLoadBalancer | undefined;
    let cdn: cloudfront.Distribution | undefined;
    if (!https) {
      internalAlb = new elbv2.ApplicationLoadBalancer(this, 'InternalAlb', { vpc, internetFacing: false, vpcSubnets: { subnetGroupName: 'alb' } });
      // Only CloudFront's origin-facing addresses may reach it (looked up at deploy time; no synth-time lookup).
      const prefixList = new cr.AwsCustomResource(this, 'CloudFrontPrefixList', {
        onUpdate: {
          service: 'EC2',
          action: 'describeManagedPrefixLists',
          parameters: { Filters: [{ Name: 'prefix-list-name', Values: ['com.amazonaws.global.cloudfront.origin-facing'] }] },
          physicalResourceId: cr.PhysicalResourceId.of('cloudfront-origin-facing'),
          outputPaths: ['PrefixLists.0.PrefixListId'],
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({ actions: ['ec2:DescribeManagedPrefixLists'], resources: ['*'] })]),
        installLatestAwsSdk: false,
      });
      ack(prefixList, [{ id: 'AwsSolutions-IAM5[Resource::*]', reason: 'ec2:DescribeManagedPrefixLists has no resource-level permissions (deploy-time lookup of the CloudFront prefix list).' }]);
      // AwsCustomResource's shared handler Lambda (one per stack, a stack child).
      const crHandler = this.node.tryFindChild(`AWS${cr.AwsCustomResource.PROVIDER_FUNCTION_UUID.replaceAll('-', '')}`);
      if (!crHandler) throw new Error('AwsCustomResource handler not found: update the cdk-nag acknowledgement below');
      ack(crHandler, [{ id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]', reason: "The AwsCustomResource handler Lambda's own CloudWatch logging (AWS-managed basic execution role)." }]);
      internalAlb.connections.allowFrom(ec2.Peer.prefixList(prefixList.getResponseField('PrefixLists.0.PrefixListId')), ec2.Port.tcp(80), 'CloudFront VPC origin');
      const cdnLogs = new s3.Bucket(this, 'CdnLogs', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // CloudFront standard logs need ACLs
        lifecycleRules: [{ expiration: Duration.days(90) }],
        removalPolicy: RemovalPolicy.RETAIN,
      });
      ack(cdnLogs, [{ id: 'AwsSolutions::AwsSolutions-S1', reason: "CloudFront's standard-log bucket: only CloudFront log delivery writes to it, so its own access logs would only record that delivery." }]);
      cdn = new cloudfront.Distribution(this, 'Cdn', {
        comment: `AWS City ${env.name} API`,
        defaultBehavior: {
          origin: cfOrigins.VpcOrigin.withApplicationLoadBalancer(internalAlb, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            httpPort: 80,
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forwards Host, Origin, Authorization and the Sec-WebSocket-* headers (the JWT rides in one).
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        webAclId: deps.edgeWebAclArn,
        enableLogging: true,
        logBucket: cdnLogs,
        logFilePrefix: 'cdn/',
      });
    }
    if (cdn) {
      ack(cdn, [
        { id: 'AwsSolutions::AwsSolutions-CFR1', reason: 'A learning game for everyone: no geo restriction.' },
        { id: 'AwsSolutions::AwsSolutions-CFR4', reason: 'The free *.cloudfront.net domain uses CloudFront’s certificate, where the minimum TLS version cannot be set; use a custom domain for TLS 1.2+.'.replace('’', "'") },
      ]);
    }
    const publicHost = https ? env.domainName : cdn!.distributionDomainName;

    const origins = extensionOrigins(env);
    if (!origins.length) Annotations.of(this).addWarning('No extension can connect yet: set extensionIds (Chrome), firefoxAddonId or safari (npm run setup).');
    // The server image is built in AWS CodeBuild during the deploy (natively on ARM64), so deploying needs no
    // Docker on your machine or in CI. The pushed image lands in a scan-on-push ECR repository.
    const image = new ContainerImageBuild(this, 'ServerImage', {
      directory: REPO_ROOT,
      file: 'server/Dockerfile',
      platform: ecrAssets.Platform.LINUX_ARM64,
      // Only what server/Dockerfile copies (keeps cdk.out, node_modules and secrets out of the upload).
      ignoreMode: IgnoreMode.DOCKER,
      exclude: ['**', '!server/**', 'server/node_modules', 'server/dist', 'server/.data', 'server/test', '!src/backend/contract.ts', '!src/console/risk.ts', '!src/console/types.ts', '!src/world/**', '!shared/**'],
    });
    (image.repository as ecr.Repository).addLifecycleRule({ description: 'Keep the last 10 server images', maxImageCount: 10 });
    // The construct's shared (singleton) CodeBuild project and trigger Lambda: acknowledged on those constructs only.
    for (const helper of this.node.children.filter((c) => /^(ContainerImageBuild|DeployTimeBuildCustomResourceHandler)/.test(c.node.id))) {
      const project = helper.node.tryFindChild('Resource') as CfnResource | undefined;
      const projectId = project?.cfnResourceType === 'AWS::CodeBuild::Project' ? this.getLogicalId(project) : undefined;
      const isTrigger = helper.node.id.startsWith('DeployTimeBuildCustomResourceHandler');
      ack(helper, [
        ...(isTrigger
          ? [{ id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]', reason: "The image-build trigger Lambda's own CloudWatch logging (AWS-managed basic execution role)." }]
          : [{ id: 'AwsSolutions-IAM5[Resource::*]', reason: 'ecr:GetAuthorizationToken (the build logging in to ECR to push the image) has no resource-level permissions.' }]),
        { id: 'AwsSolutions::AwsSolutions-L1', reason: '@cdklabs/deploy-time-build pins its trigger Lambda runtime (nodejs22.x, supported); it only starts the image build.' },
        { id: 'AwsSolutions::AwsSolutions-CB4', reason: 'The build output is a container image pushed to ECR (encrypted at rest); CodeBuild artifacts are not used.' },
        { id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/AmazonElasticContainerRegistryPublicReadOnly]', reason: 'Pulls public base images from ECR Public during the build (read-only).' },
        ...['s3:GetBucket*', 's3:GetObject*', 's3:List*'].map((a) => ({ id: `AwsSolutions-IAM5[Action::${a}]`, reason: 'Reads the uploaded build context from the CDK asset bucket (Asset.grantRead).' })),
        { id: `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:s3:::cdk-hnb659fds-assets-${nagAccount(this.account)}-${env.region}/*]`, reason: 'The CDK bootstrap asset bucket holding the build context.' },
        ...(projectId
          ? [
              { id: `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:logs:${env.region}:${nagAccount(this.account)}:log-group:/aws/codebuild/<${projectId}>:*]`, reason: "The build project's own CloudWatch log streams." },
              { id: `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:codebuild:${env.region}:${nagAccount(this.account)}:report-group/<${projectId}>-*]`, reason: "The build project's own report groups (CodeBuild default policy)." },
            ]
          : []),
      ]);
    }
    const container = taskDef.addContainer('server', {
      image: image.toEcsDockerImageCode(),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'server' }),
      stopTimeout: Duration.seconds(120), // SIGTERM → drain (http.drain) → SIGKILL
      readonlyRootFilesystem: true,
      environment: {
        AWS_CITY_MODE: 'hosted',
        AWS_CITY_REGION: this.region,
        PUBLIC_HOSTS: publicHost,
        PUBLIC_URL: `https://${publicHost}`,
        EXTENSION_ORIGIN: origins.join(',') || 'chrome-extension://not-configured',
        COGNITO_USER_POOL_ID: deps.userPool.userPoolId,
        COGNITO_CLIENT_ID: deps.client.userPoolClientId,
        TABLE_NAME: deps.table.tableName,
        SCREENSHOT_BUCKET: deps.screenshots.bucketName,
        PLAYER_ROLE_TEMPLATE_URL: deps.playerRoleTemplateUrl,
        SELF_ACCOUNT_ID: this.account,
        TASK_ROLE_NAME: taskRoleName(env),
        PLAYER_ROLE_PREFIX: playerRolePrefix(env),
        KILL_SWITCH_PARAM: this.killSwitch.parameterName,
        DAILY_MODEL_CALLS: String(env.dailyModelCalls),
        GLOBAL_DAILY_MODEL_CALLS: String(env.globalDailyModelCalls),
        AWS_CITY_MODEL: env.models.main,
        AWS_CITY_LIGHT_MODEL: env.models.light,
        AWS_CITY_FALLBACK_MODEL: env.models.light,
      },
    });
    container.addPortMappings({ containerPort: 8787 });


    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: env.minTasks,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      ...(internalAlb ? { loadBalancer: internalAlb, publicLoadBalancer: false, openListener: false } : { publicLoadBalancer: true }),
      ...(zone && certificate
        ? { domainName: env.domainName, domainZone: zone, certificate, protocol: elbv2.ApplicationProtocol.HTTPS, redirectHTTP: true, sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS }
        : {}),
      idleTimeout: Duration.seconds(300), // above the server's 25 s WebSocket pings
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: Duration.seconds(30),
    });
    service.targetGroup.configureHealthCheck({ path: '/health', healthyHttpCodes: '200', interval: Duration.seconds(15), healthyThresholdCount: 2 });
    service.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '110');
    service.loadBalancer.setAttribute('routing.http.drop_invalid_header_fields.enabled', 'true');
    const albLogs = new s3.Bucket(this, 'AlbLogs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED, // ALB log delivery requires SSE-S3
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    service.loadBalancer.logAccessLogs(albLogs, 'alb');
    ack(albLogs, [{ id: 'AwsSolutions::AwsSolutions-S1', reason: "The load balancer's access-log bucket: only ELB log delivery writes to it, so its own access logs would only record that delivery." }]);
    // Internal load balancer (no domain): only CloudFront's prefix list may connect, so EC23 doesn't apply there.
    if (https) ack(service.loadBalancer, [{ id: 'AwsSolutions::AwsSolutions-EC23', reason: 'The public load balancer for api.<domain> accepts 80/443 from the internet by design (80 only redirects to HTTPS); WAF with a per-IP limit sits in front.' }]);

    const scaling = service.service.autoScaleTaskCount({ minCapacity: env.minTasks, maxCapacity: env.maxTasks });
    scaling.scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 });
    scaling.scaleOnMemoryUtilization('Memory', { targetUtilizationPercent: 70 });

    // WAF sees the HTTP requests and WebSocket upgrades; frame-level limits live in the app. A public load
    // balancer gets its own WAF with a per-IP limit. Behind CloudFront the edge WAF (EdgeStack) already
    // filters every request, and the internal load balancer only accepts CloudFront, so a second WAF
    // here would only add cost.
    if (https) {
      const waf = new wafv2.CfnWebACL(this, 'Waf', {
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        visibilityConfig: visibility(`aws-city-${env.name}`),
        rules: wafRules({ ratePerIp: true }),
      });
      new wafv2.CfnWebACLAssociation(this, 'WafAlb', { resourceArn: service.loadBalancer.loadBalancerArn, webAclArn: waf.attrArn });
      logWaf(this, waf, `aws-city-${env.name}`);
    }

    // ── Alarms ──
    const topic = new sns.Topic(this, 'Alarms', { enforceSSL: true });
    if (env.alarmEmail) topic.addSubscription(new subs.EmailSubscription(env.alarmEmail));
    const alarm = (name: string, metric: cloudwatch.IMetric, threshold: number, periods = 3, alarmName?: string) => {
      const a = new cloudwatch.Alarm(this, name, { alarmName, metric, threshold, evaluationPeriods: periods, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING });
      a.addAlarmAction(new cwActions.SnsAction(topic));
      return a;
    };
    // A fixed name: the service lists this alarm for deploy rollback, and a generated name would make the service
    // depend on an alarm that depends on the service's own load balancer (a deploy-time cycle; the ECS module warns).
    const deploy5xxName = `aws-city-${env.name}-http5xx`;
    alarm('Http5xx', service.loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: Duration.minutes(5) }), 20, 3, deploy5xxName);
    alarm('Unhealthy', service.targetGroup.metrics.unhealthyHostCount({ period: Duration.minutes(1) }), 1, 5);
    const app = (name: string) => new cloudwatch.Metric({ namespace: 'AWSCity', metricName: name, statistic: 'Sum', period: Duration.minutes(5) });
    alarm('QuotaRejections', app('QuotaRejected'), 200);
    alarm('GlobalCap', app('GlobalQuotaRejected'), 1, 1);
    alarm('ModelCallSpike', app('ModelCalls'), env.globalDailyModelCalls / 24, 2);
    // Bedrock said "slow down" (429) even after the SDK's retries: players are seeing "the AI is busy".
    alarm('ModelThrottled', app('ModelThrottled'), 10, 2);
    alarm('TableThrottled', deps.table.metricThrottledRequestsForOperations({
        // The operations the server uses (server/src/store/dynamo.ts); an alarm takes at most 10 metrics.
        operations: [dynamodb.Operation.GET_ITEM, dynamodb.Operation.PUT_ITEM, dynamodb.Operation.UPDATE_ITEM, dynamodb.Operation.DELETE_ITEM, dynamodb.Operation.QUERY, dynamodb.Operation.BATCH_WRITE_ITEM],
        period: Duration.minutes(5),
      }), 10, 2);
    // Fewer tasks than the minimum for 10 minutes: capacity or a crash loop (Container Insights).
    new cloudwatch.Metric({
      namespace: 'ECS/ContainerInsights',
      metricName: 'RunningTaskCount',
      dimensionsMap: { ClusterName: cluster.clusterName, ServiceName: service.service.serviceName },
      statistic: 'Minimum',
      period: Duration.minutes(5),
    })
      .createAlarm(this, 'TasksBelowMinimum', { threshold: env.minTasks, comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD, evaluationPeriods: 2, treatMissingData: cloudwatch.TreatMissingData.BREACHING })
      .addAlarmAction(new cwActions.SnsAction(topic));
    // A deploy that makes the 5xx alarm fire is rolled back automatically (on top of the circuit breaker).
    service.service.enableDeploymentAlarms([deploy5xxName], { behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM });

    new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `aws-city-${env.name}`,
      widgets: [
        [
          new cloudwatch.GraphWidget({ title: 'Model calls / quota', left: [app('ModelCalls'), app('QuotaRejected'), app('GlobalQuotaRejected')] }),
          new cloudwatch.GraphWidget({ title: 'ALB', left: [service.loadBalancer.metrics.activeConnectionCount(), service.loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT)] }),
          new cloudwatch.GraphWidget({ title: 'Service', left: [service.service.metricCpuUtilization(), service.service.metricMemoryUtilization()] }),
        ],
      ],
    });

    const apiUrl = `https://${publicHost}`;
    new CfnOutput(this, 'ApiUrl', { value: apiUrl });
    new CfnOutput(this, 'WsUrl', { value: apiUrl.replace(/^http/, 'ws') + '/ws' });
    new CfnOutput(this, 'KillSwitchParam', { value: this.killSwitch.parameterName });

    const IAM5 = 'AwsSolutions-IAM5';
    ack(this.taskRole, [
      { id: `${IAM5}[Resource::arn:aws:iam::*:role/${playerRolePrefix(env)}-*]`, reason: "Player roles live in every player's own account; our own account is excluded by an aws:ResourceAccount condition." },
      ...models.map((m) => ({ id: `${IAM5}[Resource::arn:aws:bedrock:*::foundation-model/${foundationModel(m)}*]`, reason: "The geo inference profile routes to this model in several of its geography's Regions." })),
      { id: `${IAM5}[Resource::AWSCity-${env.name}-Data:ExportsOutputFnGetAttScreenshotsA7A7D8A0Arn0675524A/screenshots/*]`, reason: 'Objects under the screenshots/ prefix only (one folder per player).' },
      // TableV2.grantReadWriteData on a customer-managed key: the wildcards are action families, on that one key.
      { id: `${IAM5}[Action::kms:ReEncrypt*]`, reason: 'Table data-key operations on the single table key (CDK grantReadWriteData).' },
      { id: `${IAM5}[Action::kms:GenerateDataKey*]`, reason: 'Table data-key operations on the single table key (CDK grantReadWriteData).' },
    ]);
    ack(taskDef, [
      { id: `${IAM5}[Resource::*]`, reason: 'ecr:GetAuthorizationToken does not support resource-level permissions.' },
      { id: 'AwsSolutions::AwsSolutions-ECS2', reason: 'Only non-secret configuration is passed as environment variables; the server has no secrets (task role + public JWKS).' },
    ]);
    ack(this, [
      { id: 'Construct-Annotations::@aws-cdk/core:crossStackReferencesDefaultStrong', reason: 'Strong cross-stack references are intended (Data/Auth outlive Service).' },
    ]);
  }
}
