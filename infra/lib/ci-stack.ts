import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ack, nagAccount } from './nag.js';
import type { Construct } from 'constructs';

/** The CDK bootstrap qualifier (the default); its roles are named cdk-<qualifier>-<purpose>-<account>-<region>. */
export const BOOTSTRAP_QUALIFIER = 'hnb659fds';

/**
 * GitHub Actions → AWS without long-lived keys: an OIDC provider and a deploy role that only the
 * repo's `staging` and `prod` GitHub environments can assume. It may only assume the CDK bootstrap
 * roles (which do the actual deploying), nothing else.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, repo: string, props?: StackProps) {
    super(scope, id, props);
    const provider = new iam.OpenIdConnectProvider(this, 'GitHub', { url: 'https://token.actions.githubusercontent.com', clientIds: ['sts.amazonaws.com'] });
    const role = new iam.Role(this, 'Deploy', {
      roleName: 'AWSCityGitHubDeploy',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': [`repo:${repo}:environment:staging`, `repo:${repo}:environment:prod`] },
      }),
    });
    // Only the default-qualifier bootstrap roles (deploy, file/image publishing, lookup). What they may then do
    // is set at bootstrap time: bootstrap with a scoped execution policy, not AdministratorAccess (docs/runbook.md).
    role.addToPolicy(new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: [`arn:aws:iam::${this.account}:role/cdk-${BOOTSTRAP_QUALIFIER}-*`] }));
    ack(role, [
      {
        id: `AwsSolutions-IAM5[Resource::arn:aws:iam::${nagAccount(this.account)}:role/cdk-${BOOTSTRAP_QUALIFIER}-*]`,
        reason: 'Only the CDK bootstrap roles for the default qualifier, which carry the deploy permissions.',
      },
    ]);
  }
}
