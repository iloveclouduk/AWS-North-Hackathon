import { App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AuthStack } from '../lib/auth-stack.js';
import { BudgetStack } from '../lib/budget-stack.js';
import { CiStack } from '../lib/ci-stack.js';
import { loadEnv, readSetupFile } from '../lib/config.js';
import { DataStack } from '../lib/data-stack.js';
import { EdgeStack } from '../lib/edge-stack.js';
import { ServiceStack } from '../lib/service-stack.js';

// npx cdk synth -c env=staging   |   npx cdk deploy --all -c env=prod
const app = new App();
const env = loadEnv(app);
const where = { account: env.account, region: env.region };
const prefix = `AWSCity-${env.name}`;

const data = new DataStack(app, `${prefix}-Data`, env, { env: where });
const auth = new AuthStack(app, `${prefix}-Auth`, env, { env: where, authRelayUrl: data.authRelayUrl });
// No custom domain → CloudFront; its WAF must live in us-east-1 (cross-region reference).
const noDomain = !(env.domainName && env.hostedZoneId && env.zoneName);
const edge = noDomain ? new EdgeStack(app, `${prefix}-Edge`, env, { env: { account: env.account, region: 'us-east-1' }, crossRegionReferences: true }) : undefined;
const service = new ServiceStack(
  app,
  `${prefix}-Service`,
  env,
  { ...data, playerRoleTemplateUrl: data.playerRoleTemplateUrl, userPool: auth.userPool, client: auth.client, edgeWebAclArn: edge?.webAclArn },
  { env: where, crossRegionReferences: Boolean(edge) },
);
const budget = new BudgetStack(app, `${prefix}-Budget`, env, { env: where });
budget.node.addDependency(service); // the budget action targets the task role

const repo = (app.node.tryGetContext('githubRepo') as string | undefined) || (readSetupFile().githubRepo as string | undefined);
if (repo) new CiStack(app, 'AWSCity-CI', repo, { env: where });

Tags.of(app).add('app', 'aws-city');
Tags.of(app).add('env', env.name);
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
