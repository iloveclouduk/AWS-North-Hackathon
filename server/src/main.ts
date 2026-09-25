import { fileURLToPath } from 'node:url';
import { createLlm } from './agents/llm.js';
import { createAgentRunner } from './agents/runner.js';
import { createActionService } from './agents/service.js';
import { createAwsClients, getAccountId } from './aws.js';
import { loadConfig } from './config.js';
import { feedEvents, welcomeEvents } from './contract/aws-feed.js';
import { createOrchestrator } from './contract/orchestrator.js';
import { createProgressStore } from './contract/progress.js';
import { createUploadStore } from './contract/uploads.js';
import { createHttpServer } from './http.js';
import { diffSnapshots } from './state/diff.js';
import { createPoller } from './state/poller.js';

const config = loadConfig();
const clients = createAwsClients(config);

let accountId: string;
try {
  accountId = await getAccountId(clients);
} catch (err) {
  console.error(`Can't reach AWS with profile "${config.awsProfile}": ${(err as Error).message}`);
  console.error('Refresh the workshop keys (see server/README.md) and start again.');
  process.exit(1);
}

const baseUrl = `http://${config.host}:${config.port}`;
let broadcast: (events: ReturnType<typeof feedEvents>) => void = () => {};

const poller = createPoller({
  clients,
  accountId,
  region: config.region,
  intervalMs: config.pollIntervalMs,
  onSnapshot(prev, next) {
    for (const event of diffSnapshots(prev, next)) broadcast(feedEvents(event));
  },
});
const snapshot = async () => poller.current() ?? poller.refresh();

const llm = createLlm(config);
const actions = createActionService({ clients, poller, region: config.region });
const runner = createAgentRunner({ llm, actions, snapshot });
const uploads = createUploadStore(baseUrl);
const orchestrator = createOrchestrator({ llm, runner, snapshot, uploads });
const progress = createProgressStore(fileURLToPath(new URL('../.data/progress.json', import.meta.url)));

await poller.refresh();
poller.start();

const http = createHttpServer({
  config,
  poller,
  orchestrator,
  uploads,
  progress,
  welcome: () => (poller.current() ? welcomeEvents(poller.current()!) : []),
});
broadcast = http.broadcast;

http.server.listen(config.port, config.host, () => {
  console.log(`AWS City backend on ${baseUrl}`);
  console.log(`  account ${accountId}, region ${config.region}, profile "${config.awsProfile}", model ${config.model}`);
  console.log(`  frontend .env.local:  WXT_BACKEND=aws  WXT_AWS_WS_URL=ws://${config.host}:${config.port}/ws  WXT_AWS_API_URL=${baseUrl}`);
  console.log(`  token (for curl/tests): ${config.token}`);
  console.log(
    config.extensionOrigins.length
      ? `  extension allowed without token: ${config.extensionOrigins.join(', ')}`
      : '  EXTENSION_ORIGIN not set: the extension needs the token (set EXTENSION_ORIGIN=chrome-extension://<id> to allow it directly)',
  );
});
