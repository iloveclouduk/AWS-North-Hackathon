# Production runbook

Architecture: the extension → HTTPS ALB (WAF) → ECS Fargate (`server/`, ARM64, ≥2 tasks) → DynamoDB
(`aws-city-<env>`), S3 (screenshots, 1-day expiry), Amazon Bedrock (Claude), the AWS Knowledge MCP
server (docs), and each player's own AWS account through `AWSCityPlayerRole-<region>`.
Everything is defined in `infra/` (CDK).

## First deploy (once per AWS account)

1. **Prerequisites** (yours): an AWS account with admin access; a Route 53 hosted zone for your
   domain; Bedrock model access for Claude Opus 5 and Sonnet 5 in the region; a Google OAuth client
   (Google Cloud Console → Credentials → OAuth client, type *Web*, redirect URI
   `https://<cognitoDomainPrefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse`); the Chrome
   Web Store item id (upload a draft once to get it); for prod, a verified SES sender.
2. Put the Google secret in Secrets Manager yourself (never in git):
   `aws secretsmanager create-secret --name aws-city/google-oauth --secret-string '{"clientSecret":"…"}'`
3. Fill `infra/cdk.json` → `staging` / `prod`: `domainName` (e.g. `api.example.com`),
   `hostedZoneId`, `zoneName`, `extensionIds` (store id + your unpacked dev id), `googleClientId`,
   `alarmEmail`, `sesFromEmail` (prod), budgets; and `githubRepo` (`owner/repo`).
4. `cd infra && npm ci && npx cdk bootstrap && npx cdk deploy --all -c env=staging`
5. GitHub → Settings → Environments: create `staging` and `prod` (prod: required reviewers). Set
   variables `AWS_DEPLOY_ROLE_ARN` (the `AWSCityGitHubDeploy` role from the CI stack) and `AWS_REGION`,
   and on `prod` also `WXT_AWS_WS_URL`, `WXT_AWS_API_URL`, `WXT_COGNITO_DOMAIN`, `WXT_COGNITO_CLIENT_ID`
   (from the stack outputs). From then on: merge to `main` → staging, approve → prod.
6. Release the extension: tag `v1.2.3` → the `release` workflow attaches the zip → upload it in
   the Chrome Web Store dashboard with `docs/store-listing.md` and `docs/privacy-policy.md`.

## Kill switch / budget

- **Manual, instant (~30 s):** `aws ssm put-parameter --name /aws-city/<env>/ai-enabled --value false --overwrite`
  (players see "the city's AI is resting"; everything else works). Turn back on with `--value true`.
- **Automatic:** at 100% of the monthly budget, AWS Budgets attaches `AWSCityDenyBedrock-<env>` to
  `AWSCityTaskRole-<env>`. Re-enable after review:
  `aws iam detach-role-policy --role-name AWSCityTaskRole-<env> --policy-arn arn:aws:iam::<acct>:policy/AWSCityDenyBedrock-<env>`
  and reset the budget action in the Budgets console.
- Per-player daily cap: `dailyModelCalls` in `cdk.json` (redeploy); global daily cap: `globalDailyModelCalls`.

## Alarms (SNS → alarmEmail)

| Alarm | Look at |
|---|---|
| Http5xx / Unhealthy | ECS service events, the `server` log group (JSON lines; `level=error`) |
| GlobalCap / ModelCallSpike | Dashboard `aws-city-<env>`; consider the kill switch |
| QuotaRejections | Normal at scale; raise `dailyModelCalls` if players are unhappy |

## Deploys and restarts

Rolling deploys are safe: a stopping task fails `/health`, tells players "the city is updating",
waits up to 100 s for running agent turns, then closes sockets with 1012; the extension reconnects
with jitter to a healthy task. The circuit breaker rolls back a bad image automatically.

## Player support

- "Can't link my account": they must create the stack from the link in the *same* region, then paste
  the 12-digit account id. The role is `AWSCityPlayerRole-<region>`; its trust is fixed to our account.
- Delete a player: they can do it themselves (Deploy → Delete my account = `DELETE /me`).

## Local development (unchanged)

`npm run live` (workshop profile, token mode, files) — see README "Real mode".
