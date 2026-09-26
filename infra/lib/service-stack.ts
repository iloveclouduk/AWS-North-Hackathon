import { fileURLToPath } from 'node:url';
import { Annotations, CfnOutput, Duration, IgnoreMode, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cfOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
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
import { ack } from './nag.js';
import type { Construct } from 'constructs';
import { type EnvConfig, playerRolePrefix, taskRoleName } from './config.js';

export interface ServiceDeps {
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
      flowLogs: { rejected: { trafficType: ec2.FlowLogTrafficType.REJECT } },
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
          // Cross-region inference profiles route to the foundation model in several US regions.
          ...models.map((m) => `arn:aws:bedrock:*::foundation-model/${m.replace(/^us\./, '')}*`),
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
    this.taskRole.addToPolicy(new iam.PolicyStatement({ sid: 'Screenshots', actions: ['s3:PutObject', 's3:GetObject'], resources: [deps.screenshots.arnForObjects('screenshots/*')] }));
    this.killSwitch.grantRead(this.taskRole);
    this.taskRole.addToPolicy(new iam.PolicyStatement({ sid: 'DeletePlayer', actions: ['cognito-idp:AdminDeleteUser'], resources: [deps.userPool.userPoolArn] }));

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
      internalAlb.connections.allowFrom(ec2.Peer.prefixList(prefixList.getResponseField('PrefixLists.0.PrefixListId')), ec2.Port.tcp(80), 'CloudFront VPC origin');
      const cdnLogs = new s3.Bucket(this, 'CdnLogs', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // CloudFront standard logs need ACLs
        lifecycleRules: [{ expiration: Duration.days(90) }],
        removalPolicy: RemovalPolicy.RETAIN,
      });
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
        enableLogging: true,
        logBucket: cdnLogs,
        logFilePrefix: 'cdn/',
      });
    }
    if (cdn) {
      ack(cdn, [
        { id: 'AwsSolutions::AwsSolutions-CFR1', reason: 'A learning game for everyone: no geo restriction.' },
        { id: 'AwsSolutions::AwsSolutions-CFR2', reason: 'The regional WAF on the load balancer inspects every request (a CloudFront-scope ACL would need a us-east-1 stack).' },
        { id: 'AwsSolutions::AwsSolutions-CFR4', reason: 'The free *.cloudfront.net domain uses CloudFront’s certificate, where the minimum TLS version cannot be set; use a custom domain for TLS 1.2+.'.replace('’', "'") },
      ]);
      ack(this, [
        { id: 'AwsSolutions-IAM5[Resource::*]', reason: 'ec2:DescribeManagedPrefixLists has no resource-level permissions (deploy-time lookup of the CloudFront prefix list).' },
        { id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]', reason: "CDK's AwsCustomResource helper Lambda logging." },
      ]);
    }
    const publicHost = https ? env.domainName : cdn!.distributionDomainName;

    const origins = env.extensionIds.map((i) => `chrome-extension://${i}`);
    if (!origins.length) Annotations.of(this).addWarning('extensionIds is empty: set the Chrome extension id(s) in cdk.json before players can connect.');
    const container = taskDef.addContainer('server', {
      image: ecs.ContainerImage.fromAsset(REPO_ROOT, {
        file: 'server/Dockerfile',
        platform: ecrAssets.Platform.LINUX_ARM64,
        // Only what server/Dockerfile copies (keeps cdk.out, node_modules and secrets out of the context).
        ignoreMode: IgnoreMode.DOCKER,
        exclude: ['**', '!server/**', 'server/node_modules', 'server/dist', 'server/.data', 'server/test', '!src/backend/contract.ts', '!src/console/risk.ts', '!src/console/types.ts', '!src/world/**', '!shared/**'],
      }),
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

    const scaling = service.service.autoScaleTaskCount({ minCapacity: env.minTasks, maxCapacity: env.maxTasks });
    scaling.scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 });
    scaling.scaleOnMemoryUtilization('Memory', { targetUtilizationPercent: 70 });

    // WAF sees the HTTP requests and WebSocket upgrades; frame-level limits live in the app.
    const waf = new wafv2.CfnWebACL(this, 'Waf', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: `aws-city-${env.name}`, sampledRequestsEnabled: true },
      rules: [
        // Saved progress can exceed the rule set's 8 KB body limit; the server caps bodies at 64 KB itself.
        managedRule('Common', 1, 'AWSManagedRulesCommonRuleSet', ['SizeRestrictions_BODY']),
        managedRule('KnownBad', 2, 'AWSManagedRulesKnownBadInputsRuleSet'),
        managedRule('IpReputation', 3, 'AWSManagedRulesAmazonIpReputationList'),
        {
          name: 'RatePerIp',
          priority: 10,
          action: { block: {} },
          // Behind CloudFront every request comes from a CloudFront address: count per viewer instead.
          statement: {
            rateBasedStatement: https
              ? { limit: 600, aggregateKeyType: 'IP', evaluationWindowSec: 300 }
              : { limit: 600, aggregateKeyType: 'FORWARDED_IP', forwardedIpConfig: { headerName: 'X-Forwarded-For', fallbackBehavior: 'MATCH' }, evaluationWindowSec: 300 },
          },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'RatePerIp', sampledRequestsEnabled: true },
        },
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'WafAlb', { resourceArn: service.loadBalancer.loadBalancerArn, webAclArn: waf.attrArn });

    // ── Alarms ──
    const topic = new sns.Topic(this, 'Alarms', { enforceSSL: true });
    if (env.alarmEmail) topic.addSubscription(new subs.EmailSubscription(env.alarmEmail));
    const alarm = (name: string, metric: cloudwatch.Metric, threshold: number, periods = 3) =>
      metric
        .createAlarm(this, name, { threshold, evaluationPeriods: periods, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING })
        .addAlarmAction(new cwActions.SnsAction(topic));
    alarm('Http5xx', service.loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: Duration.minutes(5) }), 20);
    alarm('Unhealthy', service.targetGroup.metrics.unhealthyHostCount({ period: Duration.minutes(1) }), 1, 5);
    const app = (name: string) => new cloudwatch.Metric({ namespace: 'AWSCity', metricName: name, statistic: 'Sum', period: Duration.minutes(5) });
    alarm('QuotaRejections', app('QuotaRejected'), 200);
    alarm('GlobalCap', app('GlobalQuotaRejected'), 1, 1);
    alarm('ModelCallSpike', app('ModelCalls'), env.globalDailyModelCalls / 24, 2);

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
      ...models.map((m) => ({ id: `${IAM5}[Resource::arn:aws:bedrock:*::foundation-model/${m.replace(/^us\./, '')}*]`, reason: 'Cross-region inference profiles route to the model in several US regions.' })),
      { id: `${IAM5}[Resource::AWSCity-${env.name}-Data:ExportsOutputFnGetAttScreenshotsA7A7D8A0Arn0675524A/screenshots/*]`, reason: 'Objects under the screenshots/ prefix only (one folder per player).' },
    ]);
    ack(taskDef, [{ id: `${IAM5}[Resource::*]`, reason: 'ecr:GetAuthorizationToken does not support resource-level permissions.' }]);
    ack(this, [
      { id: 'AwsSolutions::AwsSolutions-EC23', reason: 'The public ALB accepts 80/443 from the internet by design (80 only redirects to HTTPS).' },
      { id: 'AwsSolutions::AwsSolutions-ECS2', reason: 'Only non-secret configuration is passed as environment variables; the server has no secrets (task role + public JWKS).' },
      { id: 'AwsSolutions::AwsSolutions-S1', reason: 'This is the ALB access-log bucket.' },
      { id: 'Construct-Annotations::@aws-cdk/core:crossStackReferencesDefaultStrong', reason: 'Strong cross-stack references are intended (Data/Auth outlive Service).' },
    ]);
  }
}

const managedRule = (name: string, priority: number, rule: string, countOnly: string[] = []): wafv2.CfnWebACL.RuleProperty => ({
  name,
  priority,
  overrideAction: { none: {} },
  statement: {
    managedRuleGroupStatement: { vendorName: 'AWS', name: rule, ruleActionOverrides: countOnly.map((n) => ({ name: n, actionToUse: { count: {} } })) },
  },
  visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true },
});
