import { Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ack } from './nag.js';
import type { Construct } from 'constructs';
import { type EnvConfig, TASK_ROLE_NAME } from './config.js';

/**
 * Cost guard rails (we pay for Bedrock): e-mail at 50% and 80% of the monthly budget, and at 100% an
 * automatic AWS Budgets action attaches a Deny-Bedrock policy to the task role. Agents then answer
 * "the city's AI is resting"; everything else keeps working. Re-enable: detach AWSCityDenyBedrock-<env>
 * from AWSCityTaskRole (docs/runbook.md).
 */
export class BudgetStack extends Stack {
  constructor(scope: Construct, id: string, env: EnvConfig, props?: StackProps) {
    super(scope, id, props);
    const subscribers = env.alarmEmail ? [{ subscriptionType: 'EMAIL', address: env.alarmEmail }] : [];
    const budgetName = `aws-city-${env.name}-monthly`;

    new budgets.CfnBudget(this, 'Monthly', {
      budget: { budgetName, budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: env.monthlyBudgetUsd, unit: 'USD' } },
      notificationsWithSubscribers: subscribers.length
        ? [50, 80].map((threshold) => ({
            notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE' },
            subscribers: subscribers.map((s) => ({ subscriptionType: s.subscriptionType, address: s.address })),
          }))
        : undefined,
    });

    const deny = new iam.ManagedPolicy(this, 'DenyBedrock', {
      managedPolicyName: `AWSCityDenyBedrock-${env.name}`,
      description: 'Attached automatically by the AWS City budget action at 100% of the monthly budget.',
      statements: [new iam.PolicyStatement({ effect: iam.Effect.DENY, actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'], resources: ['*'] })],
    });

    const actionRole = new iam.Role(this, 'BudgetActionRole', { assumedBy: new iam.ServicePrincipal('budgets.amazonaws.com') });
    actionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:AttachRolePolicy', 'iam:DetachRolePolicy'],
        resources: [`arn:aws:iam::${this.account}:role/${TASK_ROLE_NAME}`],
        conditions: { ArnEquals: { 'iam:PolicyARN': deny.managedPolicyArn } },
      }),
    );

    if (subscribers.length) {
      new budgets.CfnBudgetsAction(this, 'CutOffAi', {
        budgetName,
        actionType: 'APPLY_IAM_POLICY',
        actionThreshold: { type: 'PERCENTAGE', value: 100 },
        approvalModel: 'AUTOMATIC',
        notificationType: 'ACTUAL',
        executionRoleArn: actionRole.roleArn,
        definition: { iamActionDefinition: { policyArn: deny.managedPolicyArn, roles: [TASK_ROLE_NAME] } },
        subscribers: subscribers.map((s) => ({ type: s.subscriptionType, address: s.address })),
      }).node.addDependency(this.node.findChild('Monthly'));
    }

    ack(deny, [{ id: 'AwsSolutions-IAM5[Resource::*]', reason: 'A Deny on all Bedrock models is the point of the kill switch.' }]);
  }
}
