import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AuthStack } from '../lib/auth-stack.js';
import { BudgetStack } from '../lib/budget-stack.js';
import { type EnvConfig, TASK_ROLE_NAME } from '../lib/config.js';
import { DataStack } from '../lib/data-stack.js';
import { ServiceStack } from '../lib/service-stack.js';

const env: EnvConfig = {
  name: 'staging', region: 'us-west-2', domainName: 'api.example.com', hostedZoneId: 'Z1', zoneName: 'example.com',
  cognitoDomainPrefix: 'aws-city-test', extensionIds: ['abcdefghijklmnopabcdefghijklmnop'], googleClientId: 'g.apps.googleusercontent.com',
  sesFromEmail: '', alarmEmail: 'ops@example.com', monthlyBudgetUsd: 50, dailyModelCalls: 100, globalDailyModelCalls: 5000,
  minTasks: 2, maxTasks: 4, models: { main: 'us.anthropic.claude-opus-5', light: 'us.anthropic.claude-sonnet-5' },
};

const build = () => {
  const app = new App();
  const where = { env: { account: '111122223333', region: 'us-west-2' } };
  const data = new DataStack(app, 'D', env, where);
  const auth = new AuthStack(app, 'A', env, where);
  const svc = new ServiceStack(app, 'S', env, { table: data.table, screenshots: data.screenshots, playerRoleTemplateUrl: data.playerRoleTemplateUrl, userPool: auth.userPool, client: auth.client }, where);
  const budget = new BudgetStack(app, 'B', env, where);
  return { data: Template.fromStack(data), auth: Template.fromStack(auth), svc: Template.fromStack(svc), budget: Template.fromStack(budget) };
};

describe('infrastructure guarantees', () => {
  const t = build();

  it('task role: fixed name, may only assume player roles outside our own account', () => {
    t.svc.hasResourceProperties('AWS::IAM::Role', { RoleName: TASK_ROLE_NAME });
    t.svc.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Sid: 'AssumePlayerRoles', Action: 'sts:AssumeRole', Resource: 'arn:aws:iam::*:role/AWSCityPlayerRole-*', Condition: { StringNotEquals: { 'aws:ResourceAccount': '111122223333' } } }),
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
  });
});
