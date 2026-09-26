#!/usr/bin/env node
// AWS City one-shot setup: `npm run setup` from the repo root.
//
// Asks only what a person has to decide, checks everything it can against your AWS account, then
// deploys the whole stack (CDK), smoke-tests it and builds the Chrome extension for it. It asks
// before every change to AWS, keeps secrets out of files and logs, and is safe to run again.
//
//   npm run setup                         interactive
//   npm run setup -- --dry-run            ask + check, write aws-city.config.json, change nothing in AWS
//   npm run setup -- --yes --env staging  non-interactive: reuse aws-city.config.json (CI)
//   npm run setup -- --destroy --env staging
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { CognitoIdentityProviderClient, DescribeUserPoolDomainCommand } from '@aws-sdk/client-cognito-identity-provider';
import { IAMClient, ListOpenIDConnectProvidersCommand } from '@aws-sdk/client-iam';
import { ListHostedZonesCommand, Route53Client } from '@aws-sdk/client-route-53';
import { CreateSecretCommand, DescribeSecretCommand, PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { CreateEmailIdentityCommand, GetEmailIdentityCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INFRA = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = `${ROOT}aws-city.config.json`;
const MODELS = ['us.anthropic.claude-opus-5', 'us.anthropic.claude-sonnet-5'];
const GOOGLE_SECRET = 'aws-city/google-oauth';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const DRY = flag('--dry-run');
const YES = flag('--yes');

const saved = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {};
const { DEV_EXTENSION_ID } = await import(new URL('../../scripts/extension-id.mjs', import.meta.url));

const bye = (msg = 'Stopped. Nothing else was changed.') => {
  p.cancel(msg);
  process.exit(1);
};
/** Ask, or reuse the saved answer with --yes. */
const ask = async (kind, o, savedValue) => {
  if (YES && savedValue !== undefined) return savedValue;
  if (YES) bye(`--yes needs "${o.message}" in aws-city.config.json`);
  const v = await p[kind](o);
  if (p.isCancel(v)) bye();
  return v;
};
const run = (cmd, argv, cwd = ROOT, env = {}) => {
  const r = spawnSync(cmd, argv, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) bye(`${cmd} ${argv.join(' ')} failed (exit ${r.status}). Fix the error above and run setup again — it picks up where it left off.`);
};
const has = (cmd, argv) => spawnSync(cmd, argv, { stdio: 'ignore' }).status === 0;
const approve = async (what) => {
  if (DRY) {
    p.log.info(`[dry run] would ${what}`);
    return false;
  }
  if (YES) return true;
  return ask('confirm', { message: `OK to ${what}?`, initialValue: true });
};

p.intro(' AWS City setup ');
p.note(
  [
    'This deploys AWS City into YOUR AWS account:',
    '  CloudFront/ALB → ECS Fargate server → DynamoDB, S3, Amazon Bedrock (Claude), Cognito sign-in.',
    'Rough cost while idle: ~$35–60/month (2 small Fargate tasks, load balancer, CloudFront);',
    'Claude on Bedrock is pay-per-use and capped by a daily quota + a budget kill switch.',
    'You can remove everything later with: npm run setup -- --destroy',
  ].join('\n'),
  'What this does',
);

// ── 1. Preflight ─────────────────────────────────────────────────────────────
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) bye(`Node ${process.versions.node} is too old: install Node 22 or newer (https://nodejs.org).`);
if (!DRY && !flag('--destroy')) {
  if (!has('docker', ['info'])) bye('Docker is needed to build the server image. Start Docker Desktop (or install it) and run setup again.');
  if (!has('docker', ['buildx', 'version'])) bye('Docker buildx is needed (it builds the ARM64 image). Update Docker Desktop and run setup again.');
}

const envName = opt('--env') ?? (await ask('select', { message: 'Which environment?', options: [{ value: 'prod', label: 'prod', hint: 'the real one players use' }, { value: 'staging', label: 'staging', hint: 'a test copy' }], initialValue: saved.lastEnv ?? 'prod' }, saved.lastEnv));
const prev = saved[envName] ?? {};

const region = await ask('text', { message: 'AWS Region to deploy in', placeholder: 'us-west-2', initialValue: prev.region ?? process.env.AWS_REGION ?? 'us-west-2', validate: (v) => (/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(v) ? undefined : 'e.g. us-west-2') }, prev.region);
const credentials = fromNodeProviderChain({ profile: process.env.AWS_PROFILE });
const aws = (C) => new C({ region, credentials });

const s = p.spinner();
s.start('Checking your AWS sign-in');
let account;
try {
  const id = await aws(STSClient).send(new GetCallerIdentityCommand({}));
  account = id.Account;
  s.stop(`Signed in to AWS account ${account} as ${id.Arn?.split(':').pop()}`);
} catch (err) {
  s.stop('Not signed in to AWS', 1);
  p.log.error(err.message ?? String(err));
  if (!DRY) bye('Sign in first, then run setup again:\n  aws login            (AWS CLI 2.32+)\n  or: aws configure sso  /  export AWS_PROFILE=<profile>');
  account = '000000000000';
  p.log.warn('[dry run] continuing without AWS: checks are skipped, nothing is written to AWS.');
}
const offline = account === '000000000000';

if (flag('--destroy')) {
  p.log.warn(`This deletes the ${envName} stacks in ${account} (${region}). The table and buckets are kept (retained) so no player data is lost by accident.`);
  if (!(await approve(`delete the AWSCity-${envName} stacks`))) bye();
  run('npx', ['cdk', 'destroy', '--all', '-c', `env=${envName}`, '--force'], INFRA);
  p.outro('Stacks deleted. Delete the retained table/buckets in the console if you really want them gone.');
  process.exit(0);
}

// ── 2. Bedrock model access ──────────────────────────────────────────────────
s.start('Checking Claude on Amazon Bedrock');
const missing = [];
for (const modelId of offline ? [] : MODELS) {
  try {
    await aws(BedrockRuntimeClient).send(new ConverseCommand({ modelId, messages: [{ role: 'user', content: [{ text: 'hi' }] }], inferenceConfig: { maxTokens: 1 } }));
  } catch (err) {
    missing.push(`${modelId}: ${err.name}`);
  }
}
if (missing.length) {
  s.stop('Bedrock model access is not ready', 1);
  p.log.error(missing.join('\n'));
  p.note(`Open https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/modelaccess\nand enable Anthropic Claude Opus 5 and Claude Sonnet 5, then run setup again.`, 'Enable model access');
  if (!DRY) bye();
} else s.stop(offline ? '[dry run] Bedrock check skipped' : 'Claude Opus 5 and Sonnet 5 are available');

// ── 3. Domain: yours, or free HTTPS from CloudFront ──────────────────────────
let zones = [];
try {
  zones = (await aws(Route53Client).send(new ListHostedZonesCommand({}))).HostedZones?.filter((z) => !z.Config?.PrivateZone) ?? [];
} catch {
  /* no Route 53 access: offer CloudFront only */
}
const zoneChoice = await ask(
  'select',
  {
    message: 'Web address for the server',
    options: [
      { value: '', label: 'No domain — use CloudFront HTTPS (https://xxxx.cloudfront.net)', hint: 'recommended, nothing to buy' },
      ...zones.map((z) => ({ value: z.Id.replace('/hostedzone/', ''), label: `api.${z.Name.replace(/\.$/, '')}`, hint: 'your Route 53 zone' })),
    ],
    initialValue: prev.hostedZoneId ?? '',
  },
  prev.hostedZoneId,
);
const zone = zones.find((z) => z.Id.endsWith(zoneChoice));
const zoneName = zone ? zone.Name.replace(/\.$/, '') : '';
const domainName = zone ? await ask('text', { message: 'API hostname', initialValue: prev.domainName || `api.${zoneName}` }, prev.domainName) : '';

// ── 4. Sign-in (Cognito) ─────────────────────────────────────────────────────
// Cognito refuses prefixes containing reserved words such as aws, amazon or cognito.
const suggested = `cloud-city-${envName === 'prod' ? '' : `${envName}-`}${account.slice(-6)}`;
let cognitoDomainPrefix;
for (;;) {
  cognitoDomainPrefix = await ask('text', { message: 'Sign-in page name (Cognito domain prefix)', initialValue: prev.cognitoDomainPrefix ?? suggested, validate: (v) => (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v) ? 'lowercase letters, digits and -' : /aws|amazon|cognito/.test(v) ? 'can’t contain aws, amazon or cognito' : undefined) }, prev.cognitoDomainPrefix);
  const d = offline ? {} : await aws(CognitoIdentityProviderClient).send(new DescribeUserPoolDomainCommand({ Domain: cognitoDomainPrefix })).catch(() => ({}));
  const owner = d.DomainDescription?.UserPoolId;
  if (!owner || d.DomainDescription?.AWSAccountId === account) break; // free, or already ours (re-run)
  if (YES) bye(`The sign-in name "${cognitoDomainPrefix}" is taken; pick another in aws-city.config.json.`);
  p.log.warn(`"${cognitoDomainPrefix}" is taken by another AWS account. Try another name.`);
}
const cognitoHost = `${cognitoDomainPrefix}.auth.${region}.amazoncognito.com`;

// ── 5. Google sign-in (optional) ─────────────────────────────────────────────
const useGoogle = await ask('confirm', { message: 'Add "Sign in with Google"? (email + password always works)', initialValue: Boolean(prev.googleClientId) }, Boolean(prev.googleClientId));
let googleClientId = '';
if (useGoogle) {
  p.note(
    [
      '1. https://console.cloud.google.com/apis/credentials → Create credentials → OAuth client ID',
      '   (first time: configure the consent screen: External, app name "AWS City", your email).',
      '2. Application type: Web application. Name: AWS City.',
      `3. Authorised JavaScript origins:  https://${cognitoHost}`,
      `4. Authorised redirect URIs:       https://${cognitoHost}/oauth2/idpresponse`,
      '5. Create → copy the Client ID and Client secret.',
    ].join('\n'),
    'Google Cloud Console (2 minutes)',
  );
  googleClientId = await ask('text', { message: 'Google Client ID', initialValue: prev.googleClientId, validate: (v) => (/\.apps\.googleusercontent\.com$/.test(v) ? undefined : 'ends with .apps.googleusercontent.com') }, prev.googleClientId);
  const sm = aws(SecretsManagerClient);
  const exists = offline ? false : await sm.send(new DescribeSecretCommand({ SecretId: GOOGLE_SECRET })).then(() => true, () => false);
  const update = !exists || (!YES && (await ask('confirm', { message: 'A Google secret is already stored in Secrets Manager. Replace it?', initialValue: false })));
  if (update) {
    // Hidden prompt → straight to Secrets Manager. Never written to disk or printed.
    const secret = YES ? process.env.GOOGLE_CLIENT_SECRET : await ask('password', { message: 'Google Client secret (hidden)', validate: (v) => (v?.length >= 10 ? undefined : 'paste the client secret') });
    if (!secret) bye('Set GOOGLE_CLIENT_SECRET for --yes runs.');
    if (await approve(`store the Google client secret in Secrets Manager as "${GOOGLE_SECRET}"`)) {
      const SecretString = JSON.stringify({ clientSecret: secret });
      if (exists) await sm.send(new PutSecretValueCommand({ SecretId: GOOGLE_SECRET, SecretString }));
      else await sm.send(new CreateSecretCommand({ Name: GOOGLE_SECRET, SecretString, Description: 'AWS City: Google OAuth client secret for Cognito' }));
      p.log.success('Google secret stored in Secrets Manager.');
    }
  }
}

// ── 6. Emails ────────────────────────────────────────────────────────────────
const alarmEmail = await ask('text', { message: 'Email for alarms and budget alerts (you’ll get a confirmation email to click)', initialValue: prev.alarmEmail ?? '', validate: (v) => (!v || /^\S+@\S+\.\S+$/.test(v) ? undefined : 'an email address, or leave empty') }, prev.alarmEmail);
const monthlyBudgetUsd = Number(await ask('text', { message: 'Monthly AWS budget in USD (AI switches off at 100%)', initialValue: String(prev.monthlyBudgetUsd ?? (envName === 'prod' ? 300 : 50)), validate: (v) => (Number(v) > 0 ? undefined : 'a number') }, prev.monthlyBudgetUsd));
const useSes = await ask('confirm', { message: 'Send sign-up emails from your own address with Amazon SES? (otherwise Cognito’s default sender, ~50/day)', initialValue: Boolean(prev.sesFromEmail) }, Boolean(prev.sesFromEmail));
let sesFromEmail = '';
if (useSes) {
  sesFromEmail = await ask('text', { message: 'From address (e.g. noreply@yourdomain.com)', initialValue: prev.sesFromEmail, validate: (v) => (/^\S+@\S+\.\S+$/.test(v) ? undefined : 'an email address') }, prev.sesFromEmail);
  const ses = aws(SESv2Client);
  const status = offline ? undefined : await ses.send(new GetEmailIdentityCommand({ EmailIdentity: sesFromEmail })).then((r) => r.VerifiedForSendingStatus, () => undefined);
  if (status === undefined && (await approve(`ask SES to verify ${sesFromEmail} (it sends a verification email)`))) {
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: sesFromEmail }));
    p.log.warn(`Click the link in the email SES sent to ${sesFromEmail} before players sign up. (New SES accounts are in the sandbox: request production access in the SES console.)`);
  } else if (status === false) p.log.warn(`${sesFromEmail} isn't verified yet: click the SES email link.`);
}

// ── 7. Chrome extension ids ──────────────────────────────────────────────────
const storeId = await ask('text', { message: 'Chrome Web Store extension id (leave empty until you have one)', initialValue: (prev.extensionIds ?? []).find((i) => i !== DEV_EXTENSION_ID) ?? '', validate: (v) => (!v || /^[a-p]{32}$/.test(v) ? undefined : '32 letters a–p') }, (prev.extensionIds ?? []).find((i) => i !== DEV_EXTENSION_ID) ?? '');
const extensionIds = [DEV_EXTENSION_ID, ...(storeId ? [storeId] : [])];

// ── 8. GitHub CI/CD (optional) ───────────────────────────────────────────────
let githubRepo = saved.githubRepo ?? '';
const wantCi = await ask('confirm', { message: 'Set up GitHub Actions deploys (OIDC, no stored keys)?', initialValue: Boolean(githubRepo) }, Boolean(githubRepo));
if (wantCi) {
  githubRepo = await ask('text', { message: 'GitHub repo (owner/name)', initialValue: githubRepo || 'iloveclouduk/AWS-North-Hackathon', validate: (v) => (/^[\w.-]+\/[\w.-]+$/.test(v) ? undefined : 'owner/name') }, githubRepo);
  const providers = offline ? [] : await aws(IAMClient).send(new ListOpenIDConnectProvidersCommand({})).then((r) => r.OpenIDConnectProviderList ?? [], () => []);
  if (providers.some((x) => x.Arn?.endsWith('token.actions.githubusercontent.com'))) {
    p.log.warn('This account already has a GitHub OIDC provider, so the CI stack is skipped (it would clash). Point your existing deploy role at the CDK bootstrap roles instead.');
    githubRepo = '';
  }
} else githubRepo = '';

// ── 9. Save the answers (no secrets) ─────────────────────────────────────────
const envConfig = {
  region, domainName, hostedZoneId: zone ? zoneChoice : '', zoneName, cognitoDomainPrefix, extensionIds, googleClientId, sesFromEmail, alarmEmail,
  monthlyBudgetUsd, dailyModelCalls: prev.dailyModelCalls ?? 100, globalDailyModelCalls: prev.globalDailyModelCalls ?? (envName === 'prod' ? 20000 : 5000),
  minTasks: prev.minTasks ?? (envName === 'prod' ? 2 : 1), maxTasks: prev.maxTasks ?? (envName === 'prod' ? 10 : 3),
};
writeFileSync(CONFIG, `${JSON.stringify({ ...saved, lastEnv: envName, account, githubRepo, [envName]: envConfig }, null, 2)}\n`);
p.log.success('Saved your answers to aws-city.config.json (gitignored; no secrets in it).');

// ── 10. Deploy ───────────────────────────────────────────────────────────────
const cdkEnv = { CDK_DEFAULT_ACCOUNT: account, CDK_DEFAULT_REGION: region, AWS_REGION: region };
if (!existsSync(`${INFRA}node_modules`)) run('npm', ['ci'], INFRA);
// No custom domain → CloudFront, whose WAF lives in us-east-1: that region needs CDK too.
for (const r of offline ? [] : [...new Set([region, ...(domainName ? [] : ['us-east-1'])])]) {
  const cfn = new CloudFormationClient({ region: r, credentials });
  const ready = await cfn.send(new DescribeStacksCommand({ StackName: 'CDKToolkit' })).then(() => true, () => false);
  if (!ready && (await approve(`prepare ${account}/${r} for CDK (cdk bootstrap, one time)`))) run('npx', ['cdk', 'bootstrap', `aws://${account}/${r}`], INFRA, cdkEnv);
}
const outputsFile = `${INFRA}outputs.${envName}.json`;
if (await approve(`deploy AWS City (${envName}) — about 15–25 minutes the first time`)) {
  // Interactive runs show IAM/security changes and ask before applying them.
  run('npx', ['cdk', 'deploy', '--all', '-c', `env=${envName}`, '--require-approval', YES ? 'never' : 'broadening', '--outputs-file', outputsFile], INFRA, cdkEnv);
  run('node', ['scripts/smoke-hosted.mjs', outputsFile, envName]);
}
if (DRY || !existsSync(outputsFile)) {
  p.outro(DRY ? 'Dry run done: aws-city.config.json is ready. Run `npm run setup` to deploy.' : 'Not deployed. Run setup again when you’re ready.');
  process.exit(0);
}

// ── 11. Build the extension for this backend ─────────────────────────────────
const out = JSON.parse(readFileSync(outputsFile, 'utf8'));
const pick = (stack, key) => out[`AWSCity-${envName}-${stack}`]?.[key];
const envFile = [
  'WXT_BACKEND=hosted',
  `WXT_AWS_WS_URL=${pick('Service', 'WsUrl')}`,
  `WXT_AWS_API_URL=${pick('Service', 'ApiUrl')}`,
  `WXT_COGNITO_DOMAIN=${pick('Auth', 'CognitoDomain')}`,
  `WXT_COGNITO_CLIENT_ID=${pick('Auth', 'CognitoClientId')}`,
].join('\n');
writeFileSync(`${ROOT}.env.production`, `${envFile}\n`);
if (!existsSync(`${ROOT}node_modules`)) run('npm', ['ci']);
run('npx', ['wxt', 'build', '--mode', 'production']);
run('npx', ['wxt', 'zip', '--mode', 'production'], ROOT, { WXT_STORE_BUILD: 'true' });

p.note(
  [
    `Server:   ${pick('Service', 'ApiUrl')}`,
    `Sign-in:  ${pick('Auth', 'CognitoDomain')}`,
    '',
    'Try it now: chrome://extensions → Developer mode → Load unpacked → .output/chrome-mv3',
    `  (its id is ${DEV_EXTENSION_ID}, already allowed to sign in).`,
    'Publish:   upload .output/*-chrome.zip in the Chrome Web Store dashboard (docs/chrome-web-store.md),',
    '           then run setup again with the store id so store users can sign in too.',
    alarmEmail ? `Confirm:   click the AWS Notification emails sent to ${alarmEmail}.` : '',
    githubRepo ? `GitHub:    add AWS_DEPLOY_ROLE_ARN (see the AWSCity-CI stack) + AWS_REGION=${region} to the ${envName} environment.` : '',
    'Kill switch / runbook: docs/runbook.md',
  ]
    .filter((l) => l !== undefined)
    .join('\n'),
  'AWS City is live',
);
p.outro('Done. Have fun in the city!');
