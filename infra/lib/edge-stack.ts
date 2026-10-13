import { Stack, type StackProps } from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';
import type { EnvConfig } from './config.js';
import { logWaf, visibility, wafRules } from './waf.js';

/**
 * The CloudFront-scope WAF (AWS requires these in us-east-1). At the edge the WAF sees each viewer's
 * real IP, so the per-IP rate limit and IP reputation work; used when there's no custom domain.
 */
export class EdgeStack extends Stack {
  readonly webAclArn: string;

  constructor(scope: Construct, id: string, env: EnvConfig, props?: StackProps) {
    super(scope, id, props);
    const acl = new wafv2.CfnWebACL(this, 'EdgeWaf', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility(`aws-city-${env.name}-edge`),
      rules: wafRules({ ratePerIp: true }),
    });
    this.webAclArn = acl.attrArn;
    logWaf(this, acl, `aws-city-${env.name}-edge`);
  }
}
