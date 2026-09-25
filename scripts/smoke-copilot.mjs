// End-to-end Console Copilot check: a fake S3 console page is served at a real console URL (so the
// extension's content script loads), then the city asks the Copilot to create a bucket (mock backend).
// Usage: npm run build && node scripts/smoke-copilot.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ext = path.resolve('.output/chrome-mv3');
const out = path.resolve(process.argv[2] ?? '.output/smoke');
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURE = fs.readFileSync('tests/fixtures/s3-console.html', 'utf8');

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'awscity-cp-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1300, height: 820 },
});
await ctx.route('https://us-west-2.console.aws.amazon.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE }));
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errors = [];

const city = await ctx.newPage();
city.on('pageerror', (e) => errors.push(`city: ${e.message}`));
await city.goto(`chrome-extension://${id}/city.html`);
await wait(2500);

const consoleTab = await ctx.newPage();
consoleTab.on('pageerror', (e) => errors.push(`console: ${e.message}`));
await consoleTab.goto('https://us-west-2.console.aws.amazon.com/s3/buckets?region=us-west-2');
await wait(2000);
const focus = await city.evaluate(() => window.awsCity.useCity.getState().focus);
console.log('focus:', focus?.kind, focus?.serviceId, 'tab', focus?.tabId);

await city.evaluate(() => window.awsCity.startConsoleCopilot('Create an S3 bucket'));
for (let i = 0; i < 8; i++) {
  await wait(2200);
  await consoleTab.screenshot({ path: `${out}/copilot-${i}.png` });
  const done = await consoleTab.evaluate(() => document.body.innerText.includes('Successfully created bucket'));
  if (done) break;
}
await wait(2500);
await consoleTab.screenshot({ path: `${out}/copilot-final.png` });
await city.bringToFront();
await city.screenshot({ path: `${out}/copilot-city.png` });
const result = await consoleTab.evaluate(() => ({
  created: document.body.innerText.match(/Successfully created bucket "([^"]+)"/)?.[1],
  deleteClicked: document.body.innerText.includes('deleted'),
}));
const feed = await city.evaluate(() => window.awsCity.useCity.getState().feed.filter((f) => f.text.includes('🖱️')).map((f) => f.text.slice(0, 90)));
console.log('result:', JSON.stringify(result));
console.log('steps:\n  ' + feed.join('\n  '));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
await ctx.close();
process.exit(result.created && !errors.length ? 0 : 1);
