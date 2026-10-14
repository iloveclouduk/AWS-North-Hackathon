import { Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { ack } from './nag.js';
import type { Construct } from 'constructs';
import { type EnvConfig, taskRoleName } from './config.js';

/**
 * Cost guard rails (we pay for Bedrock): alerts at 50% and 80% of the monthly budget and when the month is
 * forecast to overrun, and at 100% an automatic AWS Budgets action attaches a Deny-Bedrock policy to the task
 * role. Agents then answer "the city's AI is resting"; everything else keeps working. Re-enable: detach
 * AWSCityDenyBedrock-<env> from AWSCityTaskRole-<env> (docs/runbook.md).
 *
 * Budgets notify an SNS topic, so the cut-off exists even with no alarm e-mail (a Budgets action needs at
 * least one subscriber); the e-mail, when set, subscribes to the topic.
 */
export class BudgetStack extends Stack {
  constructor(scope: Construct, id: string, env: EnvConfig, props?: StackProps) {
    super(scope, id, props);
    const budgetName = `aws-city-${env.name}-monthly`;
    const topic = new sns.Topic(this, 'BudgetAlerts', { enforceSSL: true });
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [topic.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    );
    if (env.alarmEmail) topic.addSubscription(new subs.EmailSubscription(env.alarmEmail));
    const subscriber = { subscriptionType: 'SNS', address: topic.topicArn };

    const alerts: { notificationType: 'ACTUAL' | 'FORECASTED'; threshold: number }[] = [
      { notificationType: 'ACTUAL', threshold: 50 },
      { notificationType: 'ACTUAL', threshold: 80 },
      // Bedrock billing lags by hours: warn early when the month is on track to overrun.
      { notificationType: 'FORECASTED', threshold: 100 },
    ];
    new budgets.CfnBudget(this, 'Monthly', {
      budget: { budgetName, budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: env.monthlyBudgetUsd, unit: 'USD' } },
      notificationsWithSubscribers: alerts.map(({ notificationType, threshold }) => ({
        notification: { notificationType, comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE' },
        subscribers: [subscriber],
      })),
    });

    const deny = new iam.ManagedPolicy(this, 'DenyBedrock', {
      managedPolicyName: `AWSCityDenyBedrock-${env.name}`,
      description: 'Attached automatically by the AWS City budget action at 100% of the monthly budget.',
      statements: [new iam.PolicyStatement({ effect: iam.Effect.DENY, actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'], resources: ['*'] })],
    });

    // Confused-deputy guard: only Budgets acting for this account can use the role.
    const actionRole = new iam.Role(this, 'BudgetActionRole', {
      assumedBy: new iam.ServicePrincipal('budgets.amazonaws.com').withConditions({ StringEquals: { 'aws:SourceAccount': this.account } }),
    });
    actionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:AttachRolePolicy', 'iam:DetachRolePolicy'],
        resources: [`arn:aws:iam::${this.account}:role/${taskRoleName(env)}`],
        conditions: { ArnEquals: { 'iam:PolicyARN': deny.managedPolicyArn } },
      }),
    );

    new budgets.CfnBudgetsAction(this, 'CutOffAi', {
      budgetName,
      actionType: 'APPLY_IAM_POLICY',
      actionThreshold: { type: 'PERCENTAGE', value: 100 },
      approvalModel: 'AUTOMATIC',
      notificationType: 'ACTUAL',
      executionRoleArn: actionRole.roleArn,
      definition: { iamActionDefinition: { policyArn: deny.managedPolicyArn, roles: [taskRoleName(env)] } },
      subscribers: [{ type: subscriber.subscriptionType, address: subscriber.address }],
    }).node.addDependency(this.node.findChild('Monthly'), topic);

    ack(deny, [{ id: 'AwsSolutions-IAM5[Resource::*]', reason: 'A Deny on all Bedrock models is the point of the kill switch.' }]);
  }
}
