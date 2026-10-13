import { ArnFormat, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';

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
          // 2000 requests per 5 minutes per IP (~7/s). A classroom shares one NAT address, and the WAF only sees HTTP
          // requests: each player's WebSocket upgrades (with backoff) plus GET/PUT /progress (PUT debounced to one per
          // 1.5 s while progress changes, src/app/runtime.ts) and screenshot uploads. 30 players can pass 600 in a busy
          // lesson; frames, Bedrock calls and quotas are limited per player by the server, so this only stops floods.
          statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP', evaluationWindowSec: 300 } },
          visibilityConfig: visibility('RatePerIp'),
        },
      ]
    : []),
];
export { visibility };

/**
 * WAF logs to CloudWatch (the group name must start with aws-waf-logs-). Tokens ride in the Authorization
 * header (REST) and Sec-WebSocket-Protocol (sockets), so both are redacted.
 */
export const logWaf = (scope: Construct, acl: wafv2.CfnWebACL, name: string) => {
  const group = new logs.LogGroup(scope, 'WafLogs', {
    logGroupName: `aws-waf-logs-${name}`,
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.DESTROY,
  });
  new wafv2.CfnLoggingConfiguration(scope, 'WafLogging', {
    resourceArn: acl.attrArn,
    // WAF wants the log group ARN without the trailing :*.
    logDestinationConfigs: [Stack.of(scope).formatArn({ service: 'logs', resource: 'log-group', resourceName: group.logGroupName, arnFormat: ArnFormat.COLON_RESOURCE_NAME })],
    redactedFields: [{ singleHeader: { Name: 'authorization' } }, { singleHeader: { Name: 'sec-websocket-protocol' } }],
  });
  return group;
};
