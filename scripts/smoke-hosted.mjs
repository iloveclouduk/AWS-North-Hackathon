// Post-deploy smoke test for the hosted backend (run by .github/workflows/deploy.yml).
//   node scripts/smoke-hosted.mjs infra/outputs.json <staging|prod>
// Checks what must hold for every player, without needing a signed-in test user:
//   /health is up, the API and WebSocket refuse callers without a Cognito token, and the player-role
//   template is published with our account fixed as the only trusted principal.
import { readFileSync } from 'node:fs';

const [file = 'infra/outputs.json', env = 'staging'] = process.argv.slice(2);
const outputs = JSON.parse(readFileSync(file, 'utf8'));
const pick = (stack, key) => outputs[`AWSCity-${env}-${stack}`]?.[key] ?? fail(`missing output ${stack}.${key}`);
function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
const ok = (msg) => console.log(`✓ ${msg}`);

const api = pick('Service', 'ApiUrl');
const ws = pick('Service', 'WsUrl');
const template = pick('Data', 'PlayerRoleTemplateUrl');

for (let i = 0; ; i++) {
  const r = await fetch(`${api}/health`).catch(() => undefined);
  if (r?.ok) break;
  if (i > 30) fail(`${api}/health not healthy`);
  await new Promise((res) => setTimeout(res, 5000));
}
ok('health');

const noToken = await fetch(`${api}/progress`, { headers: { origin: 'chrome-extension://smoke' } });
if (noToken.status !== 403 && noToken.status !== 401) fail(`/progress without a token answered ${noToken.status}`);
const forged = await fetch(`${api}/progress`, { headers: { authorization: 'Bearer not-a-jwt' } });
if (forged.status !== 401) fail(`/progress with a forged token answered ${forged.status}`);
ok('REST refuses unsigned callers');

const refused = await new Promise((resolve) => {
  const sock = new WebSocket(ws, ['base64UrlBearerAuthorization.bm90LWEtand0', 'base64UrlBearerAuthorization']);
  sock.onopen = () => (sock.close(), resolve(false));
  sock.onerror = () => resolve(true);
  setTimeout(() => resolve(true), 10_000);
});
if (!refused) fail('WebSocket accepted a forged token');
ok('WebSocket refuses forged tokens');

const yaml = await (await fetch(template)).text();
if (!/AWSCityPlayerRole-/.test(yaml) || /__AWS_CITY_ACCOUNT_ID__/.test(yaml) || /Trusted\w*:\s*\n\s*Type:/.test(yaml)) fail('player-role template is not published correctly');
ok('player-role template published with a fixed trust');
console.log(`hosted smoke passed (${env})`);
