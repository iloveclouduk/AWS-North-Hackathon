import type * as wafv2 from 'aws-cdk-lib/aws-wafv2';

const visibility = (metricName: string) => ({ cloudWatchMetricsEnabled: true, metricName, sampledRequestsEnabled: true });

const managedRule = (name: string, priority: number, rule: string, countOnly: string[] = []): wafv2.CfnWebACL.RuleProperty => ({
  name,
  priority,
  overrideAction: { none: {} },
  statement: {
    managedRuleGroupStatement: { vendorName: 'AWS', name: rule, ruleActionOverrides: countOnly.map((n) => ({ name: n, actionToUse: { count: {} } })) },
  },
  visibilityConfig: visibility(name),
});

/**
 * AWS managed rules, plus a per-IP rate limit where the WAF sees the real viewer address: at the
 * edge (CloudFront scope) or on a public load balancer. Never on X-Forwarded-For, which a client
 * can set to anything to dodge the limit.
 */
export const wafRules = (opts: { ratePerIp: boolean }): wafv2.CfnWebACL.RuleProperty[] => [
  // Saved progress can exceed the rule set's 8 KB body limit; the server caps bodies at 64 KB itself.
  managedRule('Common', 1, 'AWSManagedRulesCommonRuleSet', ['SizeRestrictions_BODY']),
  managedRule('KnownBad', 2, 'AWSManagedRulesKnownBadInputsRuleSet'),
  managedRule('IpReputation', 3, 'AWSManagedRulesAmazonIpReputationList'),
  ...(opts.ratePerIp
    ? [
        {
          name: 'RatePerIp',
          priority: 10,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: 600, aggregateKeyType: 'IP', evaluationWindowSec: 300 } },
          visibilityConfig: visibility('RatePerIp'),
        },
      ]
    : []),
];
export { visibility };
