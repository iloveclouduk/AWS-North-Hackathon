import { readFileSync } from 'node:fs';
import { App, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';
import { AuthStack } from '../lib/auth-stack.js';
import { BudgetStack } from '../lib/budget-stack.js';
import { type EnvConfig, firefoxRedirectUrl, loadEnv, taskRoleName } from '../lib/config.js';
import { DataStack, PLAYER_ROLE_KEY, playerRoleTemplateVersion } from '../lib/data-stack.js';
import { EdgeStack } from '../lib/edge-stack.js';
import { foundationModel, geoFor, modelsFor } from '../lib/models.js';
import { ServiceStack } from '../lib/service-stack.js';

const env: EnvConfig = {
  name: 'staging', region: 'us-west-2', domainName: 'api.example.com', hostedZoneId: 'Z1', zoneName: 'example.com',
  cognitoDomainPrefix: 'cloud-city-test', extensionIds: ['abcdefghijklmnopabcdefghijklmnop'], googleClientId: 'g.apps.googleusercontent.com',
  sesFromEmail: '', alarmEmail: 'ops@example.com', monthlyBudgetUsd: 50, dailyModelCalls: 100, globalDailyModelCalls: 5000,
  minTasks: 2, maxTasks: 4, models: { main: 'us.anthropic.claude-opus-5-5', light: 'us.anthropic.claude-sonnet-5-5' },
};

const build = (over: Partial<EnvConfig> = {}) => {
  const app = new App();
  const env2 = { ...env, ...over };
  const where = { env: { account: '111122223333', region: env2.region } };
  const data = new DataStack(app, 'D', env2, where);
  const auth = new AuthStack(app, 'A', env2, { ...where, authRelayUrl: data.authRelayUrl });
  const svc = new ServiceStack(app, 'S', env2, { table: data.table, screenshots: data.screenshots, playerRoleTemplateUrl: data.playerRoleTemplateUrl, userPool: auth.userPool, client: auth.client }, where);
  const budget = new BudgetStack(app, 'B', env2, where);
  return { data: Template.fromStack(data), auth: Template.fromStack(auth), svc: Template.fromStack(svc), budget: Template.fromStack(budget) };
};

describe('infrastructure guarantees', () => {
  const t = build();

  it('task role: fixed name, may only assume player roles outside our own account', () => {
    t.svc.hasResourceProperties('AWS::IAM::Role', { RoleName: taskRoleName(env) });
    t.svc.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Sid: 'AssumePlayerRoles', Action: 'sts:AssumeRole', Resource: 'arn:aws:iam::*:role/AWSCityPlayerRole-staging-*', Condition: { StringNotEquals: { 'aws:ResourceAccount': '111122223333' } } }),
        ]),
      },
    });
    // No broad grants to the task role.
    const json = JSON.stringify(t.svc.findResources('AWS::IAM::Policy'));
    expect(json).not.toMatch(/"Action":"\*"/);
    expect(json).not.toContain('iam:PassRole');
  });

  it('HTTPS load balancer with WAF, access logs and a long idle timeout for WebSockets', () => {
    t.svc.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Protocol: 'HTTPS', Port: 443 });
    t.svc.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    t.svc.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      LoadBalancerAttributes: Match.arrayWith([{ Key: 'idle_timeout.timeout_seconds', Value: '300' }, { Key: 'access_logs.s3.enabled', Value: 'true' }]),
    });
    t.svc.hasResourceProperties('AWS::ECS::TaskDefinition', { RuntimePlatform: { CpuArchitecture: 'ARM64' } });
  });

  it('table has point-in-time recovery, TTL and deletion protection; screenshots expire after a day', () => {
    t.data.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      Replicas: Match.arrayWith([Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }, DeletionProtectionEnabled: true })]),
    });
    t.data.hasResourceProperties('AWS::S3::Bucket', { LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: 1 })]) } });
  });

  it('prod blocks risky sign-ins (Plus plan, threat protection enforced); staging stays on Essentials', () => {
    const prod = Template.fromStack(new AuthStack(new App(), 'P', { ...env, name: 'prod' }, { env: { account: '111122223333', region: 'us-west-2' } }));
    prod.hasResourceProperties('AWS::Cognito::UserPool', { UserPoolTier: 'PLUS', UserPoolAddOns: { AdvancedSecurityMode: 'ENFORCED' } });
    prod.hasResourceProperties('AWS::Cognito::UserPoolRiskConfigurationAttachment', {
      AccountTakeoverRiskConfiguration: { Actions: Match.objectLike({ HighAction: { EventAction: 'BLOCK', Notify: false } }) },
    });
    t.auth.hasResourceProperties('AWS::Cognito::UserPool', { UserPoolTier: 'ESSENTIALS' });
    t.auth.resourceCountIs('AWS::Cognito::UserPoolRiskConfigurationAttachment', 0);
  });

  it('the server can check a player has MFA before they link an AWS account', () => {
    t.svc.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Sid: 'CheckPlayerMfa', Action: 'cognito-idp:AdminGetUser' })]) },
    });
    t.auth.hasResourceProperties('AWS::Cognito::UserPoolClient', { AllowedOAuthScopes: Match.arrayWith(['aws.cognito.signin.user.admin']) });
  });

  it('the player table uses our rotated KMS key, and the task role can use it', () => {
    t.data.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    t.data.hasResourceProperties('AWS::DynamoDB::GlobalTable', { SSESpecification: Match.objectLike({ SSEEnabled: true, SSEType: 'KMS' }) });
    t.svc.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: Match.arrayWith(['kms:Decrypt']) })]) },
    });
  });

  it('WAF logs go to aws-waf-logs-* with tokens redacted; no second WAF behind CloudFront', () => {
    t.svc.hasResourceProperties('AWS::WAFv2::LoggingConfiguration', {
      RedactedFields: [{ SingleHeader: { Name: 'authorization' } }, { SingleHeader: { Name: 'sec-websocket-protocol' } }],
    });
    t.svc.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: 'aws-waf-logs-aws-city-staging' });
    const cf = build({ domainName: '', hostedZoneId: '', zoneName: '' });
    cf.svc.resourceCountIs('AWS::WAFv2::WebACL', 0);
  });

  it('the table has daily AWS Backup snapshots on top of PITR, kept 35 days (privacy policy)', () => {
    t.data.resourceCountIs('AWS::Backup::BackupPlan', 1);
    t.data.hasResourceProperties('AWS::Backup::BackupPlan', {
      BackupPlan: Match.objectLike({ BackupPlanRule: [Match.objectLike({ Lifecycle: { DeleteAfterDays: 35 } })] }),
    });
    t.data.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: [Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } })],
    });
    t.data.hasResourceProperties('AWS::Backup::BackupSelection', { BackupSelection: Match.objectLike({ Resources: Match.anyValue() }) });
  });

  it('alarms cover throttling and missing tasks, and a bad deploy rolls back on the 5xx alarm', () => {
    for (const metric of ['ModelThrottled', 'RunningTaskCount']) t.svc.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: metric });
    t.svc.hasResourceProperties('AWS::ECS::Service', { DeploymentConfiguration: Match.objectLike({ Alarms: Match.objectLike({ Enable: true, Rollback: true }) }) });
  });

  it('Firefox and Safari: their sign-in callbacks, server origins and screenshot CORS are added only when enabled', () => {
    const both = build({ firefoxAddonId: 'aws-city@aws-city.dev', safari: true });
    both.auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: Match.arrayWith(['https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/', firefoxRedirectUrl('aws-city@aws-city.dev')]),
    });
    // The Safari relay page (a cross-stack reference to the templates bucket) is a callback too.
    expect(JSON.stringify(both.auth.findResources('AWS::Cognito::UserPoolClient'))).toContain('auth/callback.html');
    both.data.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedOrigins: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'moz-extension://*', 'safari-web-extension://*'] })] },
    });
    expect(JSON.stringify(both.svc.findResources('AWS::ECS::TaskDefinition'))).toContain('chrome-extension://abcdefghijklmnopabcdefghijklmnop,moz-extension://*,safari-web-extension://*');
    // Chrome only (the default): no wildcard origins anywhere.
    expect(JSON.stringify(t.svc.findResources('AWS::ECS::TaskDefinition'))).not.toContain('moz-extension');
    expect(JSON.stringify(t.auth.findResources('AWS::Cognito::UserPoolClient'))).not.toContain('allizom');
  });

  it('the Firefox redirect rule matches the extension build (scripts/extension-id.mjs)', async () => {
    const script = await import('../../scripts/extension-id.mjs');
    expect(firefoxRedirectUrl(script.FIREFOX_ADDON_ID)).toBe(script.firefoxRedirectUrl());
    // sha1('aws-city@aws-city.dev') — the value Firefox's identity.getRedirectURL() returns for this id.
    expect(firefoxRedirectUrl('aws-city@aws-city.dev')).toMatch(/^https:\/\/[0-9a-f]{40}\.extensions\.allizom\.org\/$/);
  });

  it('the server image is built in AWS during the deploy: no Docker needed on the machine running cdk', () => {
    t.svc.resourceCountIs('Custom::CDKContainerImageBuild', 1);
    t.svc.hasResourceProperties('AWS::CodeBuild::Project', { Environment: Match.objectLike({ Image: Match.stringLikeRegexp('aarch64') }) });
    t.svc.hasResourceProperties('AWS::ECR::Repository', { ImageScanningConfiguration: { ScanOnPush: true }, LifecyclePolicy: Match.anyValue() });
  });

  it('extension client is a public PKCE client with chromiumapp.org callbacks', () => {
    t.auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      CallbackURLs: ['https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'],
      SupportedIdentityProviders: Match.arrayWith(['COGNITO', 'Google']),
    });
  });

  it('budget action cuts off Bedrock automatically at 100%', () => {
    t.budget.hasResourceProperties('AWS::Budgets::BudgetsAction', { ActionType: 'APPLY_IAM_POLICY', ApprovalModel: 'AUTOMATIC', ActionThreshold: { Type: 'PERCENTAGE', Value: 100 } });
    t.budget.hasResourceProperties('AWS::Budgets::Budget', {
      NotificationsWithSubscribers: Match.arrayWith([Match.objectLike({ Notification: Match.objectLike({ NotificationType: 'FORECASTED' }) })]),
    });
  });

  it('budget cut-off exists even when no alarm e-mail is set', () => {
    const budget = Template.fromStack(new BudgetStack(new App(), 'NoEmail', { ...env, alarmEmail: '' }, { env: { account: '111122223333', region: 'us-west-2' } }));
    budget.resourceCountIs('AWS::Budgets::BudgetsAction', 1);
    budget.resourceCountIs('AWS::SNS::Subscription', 0);
  });
});

describe('no custom domain: CloudFront in front of a private load balancer', () => {
  const t = build({ domainName: '', hostedZoneId: '', zoneName: '' });

  it('CloudFront (HTTPS only, no caching) reaches an internal ALB through a VPC origin', () => {
    t.svc.resourceCountIs('AWS::CloudFront::VpcOrigin', 1);
    t.svc.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'https-only', AllowedMethods: Match.arrayWith(['POST', 'DELETE']) }) }),
    });
    t.svc.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
    // Nothing is open to the internet inbound: only CloudFront's origin-facing prefix list reaches the ALB.
    const inbound = JSON.stringify([
      ...Object.values(t.svc.findResources('AWS::EC2::SecurityGroup')).map((r) => r.Properties?.SecurityGroupIngress ?? []),
      ...Object.values(t.svc.findResources('AWS::EC2::SecurityGroupIngress')),
    ]);
    expect(inbound).not.toContain('0.0.0.0/0');
    t.svc.hasResourceProperties('AWS::EC2::SecurityGroupIngress', { SourcePrefixListId: Match.anyValue(), FromPort: 80, ToPort: 80 });
  });

  it('the server accepts exactly the CloudFront host; per-IP limits run at the edge, never on X-Forwarded-For', () => {
    const task = JSON.stringify(t.svc.findResources('AWS::ECS::TaskDefinition'));
    expect(task).toMatch(/"Name":"PUBLIC_HOSTS","Value":\{"Fn::GetAtt":\["Cdn[0-9A-F]+","DomainName"\]\}/);
    const regional = JSON.stringify(t.svc.findResources('AWS::WAFv2::WebACL'));
    expect(regional).not.toContain('FORWARDED_IP'); // a client could spoof it
    expect(regional).not.toContain('RatePerIp'); // behind CloudFront every source is a CloudFront address
    const app = new App();
    const edge = Template.fromStack(new EdgeStack(app, 'E', env, { env: { account: '111122223333', region: 'us-east-1' } }));
    edge.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'CLOUDFRONT',
      // 2000 per 5 minutes: a classroom behind one NAT address must fit (infra/lib/waf.ts).
      Rules: Match.arrayWith([Match.objectLike({ Name: 'RatePerIp', Statement: { RateBasedStatement: Match.objectLike({ AggregateKeyType: 'IP', Limit: 2000, EvaluationWindowSec: 300 }) } })]),
    });
  });

  it('staging and prod use different role names (one account can host both)', () => {
    t.svc.hasResourceProperties('AWS::IAM::Role', { RoleName: 'AWSCityTaskRole-staging' });
  });
});

describe('Claude inference profiles follow the deploy Region', () => {
  it('maps each geography to its profile prefix and refuses Regions without one (Bedrock model cards, Opus 5 / Sonnet 5)', () => {
    expect(modelsFor('us-west-2')).toEqual({ main: 'us.anthropic.claude-opus-5-5', light: 'us.anthropic.claude-sonnet-5-5' });
    expect(geoFor('ca-central-1')).toBe('us'); // Canada is a source Region of the US profile
    expect(modelsFor('eu-west-2').main).toBe('eu.anthropic.claude-opus-5-5');
    expect(modelsFor('ap-southeast-2').light).toBe('au.anthropic.claude-sonnet-5-5');
    // India has no 5.5 geo profile (Bedrock model cards, 2026-10-12): it keeps Opus 5 / Sonnet 5.
    expect(modelsFor('ap-south-1')).toEqual({ main: 'in.anthropic.claude-opus-5', light: 'in.anthropic.claude-sonnet-5' });
    for (const r of ['ap-northeast-1', 'ap-southeast-1', 'sa-east-1', 'us-gov-west-1', 'eu-west-9']) expect(() => modelsFor(r)).toThrow(/no Bedrock geo inference profile/);
    expect(foundationModel('au.anthropic.claude-opus-5-5')).toBe('anthropic.claude-opus-5-5');
  });

  it('loadEnv derives the models from the Region, and synth fails in a Region without a profile', () => {
    const cfg = { region: 'eu-central-1', cognitoDomainPrefix: 'cloud-city-x', extensionIds: [] };
    expect(loadEnv(new App({ context: { env: 'staging', staging: cfg } })).models.main).toBe('eu.anthropic.claude-opus-5-5');
    expect(() => loadEnv(new App({ context: { env: 'staging', staging: { ...cfg, region: 'ap-northeast-1' } } }))).toThrow(/ap-northeast-1/);
  });

  it("the task role may invoke exactly that geography's profiles and the models behind them", () => {
    const eu = build({ region: 'eu-west-1', models: modelsFor('eu-west-1') });
    eu.svc.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'Bedrock',
            Resource: [
              'arn:aws:bedrock:eu-west-1:111122223333:inference-profile/eu.anthropic.claude-opus-5-5',
              'arn:aws:bedrock:eu-west-1:111122223333:inference-profile/eu.anthropic.claude-sonnet-5-5',
              'arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-5-5*',
              'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-5-5*',
            ],
          }),
        ]),
      },
    });
    const task = JSON.stringify(eu.svc.findResources('AWS::ECS::TaskDefinition'));
    expect(task).toContain('"Name":"AWS_CITY_MODEL","Value":"eu.anthropic.claude-opus-5-5"');
    expect(task).not.toContain('us.anthropic');
  });
});

describe('player role template versions', () => {
  it("is published under the template's own version, and old versions are never pruned", () => {
    const yaml = readFileSync(new URL('../player-role/player-role.yaml', import.meta.url), 'utf8');
    const version = Number(/^Description:.*\bv(\d+)\s*$/m.exec(yaml)?.[1]);
    expect(version).toBeGreaterThan(0);
    expect(playerRoleTemplateVersion()).toBe(version);
    expect(PLAYER_ROLE_KEY).toBe(`player-role/v${version}.yaml`);
    expect(() => playerRoleTemplateVersion('Description: no version here')).toThrow(/template version/);
    const t = build();
    t.data.hasResourceProperties('Custom::CDKBucketDeployment', { DestinationBucketKeyPrefix: Match.absent(), Prune: false, RetainOnDelete: Match.absent() });
    t.data.hasOutput('PlayerRoleTemplateUrl', { Value: Match.objectLike({ 'Fn::Join': ['', Match.arrayWith([`/${PLAYER_ROLE_KEY}`])] }) });
    // The server hands players a setup link to that same key.
    expect(JSON.stringify(t.svc.findResources('AWS::ECS::TaskDefinition'))).toContain(`/${PLAYER_ROLE_KEY}`);
  });
});

describe('cdk-nag AwsSolutions (acknowledgements sit on the constructs they are about)', () => {
  const nagSynth = (over: Partial<EnvConfig>, stray = false) => {
    const app = new App();
    const e = { ...env, ...over, models: modelsFor(over.region ?? env.region) };
    // bin/app.ts's stack names, with a concrete account (as when `npm run setup` synthesises with credentials).
    const where = { account: '111122223333', region: e.region };
    const id = (s: string) => `AWSCity-${e.name}-${s}`;
    const data = new DataStack(app, id('Data'), e, { env: where });
    const auth = new AuthStack(app, id('Auth'), e, { env: where, authRelayUrl: data.authRelayUrl });
    const noDomain = !(e.domainName && e.hostedZoneId && e.zoneName);
    const edge = noDomain ? new EdgeStack(app, id('Edge'), e, { env: { account: where.account, region: 'us-east-1' }, crossRegionReferences: true }) : undefined;
    const svc = new ServiceStack(app, id('Service'), e, { ...data, playerRoleTemplateUrl: data.playerRoleTemplateUrl, userPool: auth.userPool, client: auth.client, edgeWebAclArn: edge?.webAclArn }, { env: where, crossRegionReferences: Boolean(edge) });
    new BudgetStack(app, id('Budget'), e, { env: where }).node.addDependency(svc);
    // An unrelated bucket without access logs must still be flagged: no stack-wide S1 acknowledgement.
    if (stray) new s3.Bucket(svc, 'Stray', { enforceSSL: true });
    Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: false }));
    return () => app.synth();
  };

  it.each([
    ['staging, CloudFront + internal ALB', { domainName: '', hostedZoneId: '', zoneName: '' }],
    ['prod, CloudFront + internal ALB', { name: 'prod' as const, domainName: '', hostedZoneId: '', zoneName: '' }],
    ['staging, custom domain + public ALB (eu-west-1)', { region: 'eu-west-1' }],
    ['prod, custom domain + public ALB', { name: 'prod' as const }],
  ])('%s synthesises clean', (_name, over) => {
    expect(nagSynth(over)).not.toThrow();
  });

  it('a new bucket without access logs is still flagged', () => {
    expect(nagSynth({ domainName: '', hostedZoneId: '', zoneName: '' }, true)).toThrow(/Service\/Stray\/Resource[\s\S]*AwsSolutions-S1|AwsSolutions-S1[\s\S]*Service\/Stray/);
  });
});
