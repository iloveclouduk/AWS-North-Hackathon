import { fileURLToPath } from 'node:url';
import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SSMClient } from '@aws-sdk/client-ssm';
import { createAccountLinker } from './accounts/link.js';
import { createLlm } from './agents/llm.js';
import { killSwitch } from './agents/metered.js';
import { createAuthenticate } from './auth.js';
import { assumedRole, createAwsClients, getAccountId, serviceCredentials } from './aws.js';
import { ConfigError, loadConfig } from './config.js';
import { createS3UploadStore, createUploadStore, type UploadStore } from './contract/uploads.js';
import { createHttpServer } from './http.js';
import { log } from './log.js';
import { dynamoStores } from './store/dynamo.js';
import { localStores } from './store/local.js';
import { createTenants, playerAws } from './tenants.js';

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Config: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const ours = { region: config.region, credentials: serviceCredentials(config) };

// ── The player's AWS: the workshop profile (local) or their own linked account (hosted) ──
let awsFor: Parameters<typeof createTenants>[0]['awsFor'];
if (config.awsMode === 'profile') {
  const clients = createAwsClients(config);
  let accountId: string;
  try {
    accountId = await getAccountId(clients);
  } catch (err) {
    console.error(`Can't reach AWS with profile "${config.awsProfile}": ${(err as Error).message}`);
    console.error('Refresh the workshop keys (see server/README.md) and start again.');
    process.exit(1);
  }
  const local = { clients, accountId, region: config.region };
  awsFor = () => local;
} else {
  awsFor = (sub, record) => playerAws(record, sub, assumedRole);
}

const stores = config.store === 'dynamodb' ? dynamoStores({ client: new DynamoDBClient(ours), table: config.tableName! }) : localStores(fileURLToPath(new URL('../.data/progress.json', import.meta.url)));
const memoryUploads = config.uploads === 'memory' ? createUploadStore(config.publicUrl) : undefined;
const uploads: UploadStore = memoryUploads ?? createS3UploadStore({ s3: new S3Client(ours), bucket: config.screenshotBucket! });
const cognito = config.cognito ? new CognitoIdentityProviderClient(ours) : undefined;

const tenants = createTenants({
  config,
  stores,
  uploads,
  llm: createLlm(config),
  enabled: killSwitch({ ssm: config.killSwitchParam ? new SSMClient(ours) : undefined, name: config.killSwitchParam }),
  awsFor,
  linker:
    config.awsMode === 'assume-role'
      ? createAccountLinker({ accounts: stores.accounts, templateUrl: config.playerRoleTemplateUrl!, selfAccountId: config.selfAccountId!, taskRoleName: config.taskRoleName })
      : undefined,
  onDelete: cognito ? async (sub) => void (await cognito.send(new AdminDeleteUserCommand({ UserPoolId: config.cognito!.userPoolId, Username: sub }))) : undefined,
});

const http = createHttpServer({ config, tenants, authenticate: createAuthenticate(config), uploads: memoryUploads });

http.server.listen(config.port, config.host, () => {
  log.info(`AWS City backend on ${config.host}:${config.port}`, { auth: config.authMode, aws: config.awsMode, store: config.store, uploads: config.uploads, model: config.model });
  if (config.authMode === 'token') {
    const base = `http://${config.host}:${config.port}`;
    console.log(`  frontend .env.local:  WXT_BACKEND=aws  WXT_AWS_WS_URL=ws://${config.host}:${config.port}/ws  WXT_AWS_API_URL=${base}`);
    console.log(
      config.extensionOrigins.length
        ? `  extension allowed without token: ${config.extensionOrigins.join(', ')}`
        : '  EXTENSION_ORIGIN not set: the extension needs the token (set EXTENSION_ORIGIN=chrome-extension://<id> to allow it directly)',
    );
    // The token is only for local curl/tests; it is never printed in hosted mode.
    if (!process.env.AWS_CITY_TOKEN) console.log(`  token (for curl/tests): ${config.token}`);
  }
});

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal, connections: http.connections });
  // Fargate gives 120 s (stopTimeout) between SIGTERM and SIGKILL.
  void http.drain(config.authMode === 'cognito' ? 100_000 : 2_000).finally(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
