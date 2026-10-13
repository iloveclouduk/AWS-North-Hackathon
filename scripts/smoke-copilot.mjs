// End-to-end Console Copilot check, all four scripted flows (mock backend). Each fake console page is
// served at a real console URL (so the extension's content script loads), then the city asks the
// Copilot to do the task. Asserts: the resource gets "created" in the fixture, the agent never clicks a
// risky control (fixtures record clicks on [data-risky] in <body data-risky>), no page errors. Also
// exercises the chip: the speed toggle (persisted in chrome.storage.local), Pause/Resume and Explain again.
// Usage: npm run build && node scripts/smoke-copilot.mjs [outDir] [flow…]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ext = path.resolve('.output/chrome-mv3');
const out = path.resolve(process.argv[2] ?? '.output/smoke');
const only = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOST = 'https://us-west-2.console.aws.amazon.com';
const fixture = (f) => fs.readFileSync(path.join('tests/fixtures', f), 'utf8');

const FLOWS = [
  { id: 's3', goal: 'Create an S3 bucket', url: `${HOST}/s3/buckets?region=us-west-2`, file: 's3-console.html',
    created: () => document.body.innerText.match(/Successfully created bucket "([^"]+)"/)?.[1] },
  { id: 'ec2', goal: 'Launch an EC2 instance', url: `${HOST}/ec2/home?region=us-west-2#Instances:`, file: 'ec2-console.html', expect: /\(t3\.micro\)$/, confirm: 'Launch instance' },
  { id: 'dynamodb', goal: 'Create a DynamoDB table', url: `${HOST}/dynamodbv2/home?region=us-west-2#tables`, file: 'dynamodb-console.html', expect: /^city-demo-\w+ \(pk id\)$/ },
  { id: 'lambda', goal: 'Create a Lambda function', url: `${HOST}/lambda/home?region=us-west-2#/functions`, file: 'lambda-console.html', expect: /^city-hello \(Node\.js 24\.x, from scratch\)$/ },
].filter((f) => !only.length || only.includes(f.id));

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'awscity-cp-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1300, height: 820 },
});
await ctx.route(`${HOST}/**`, (r) => {
  const u = new URL(r.request().url());
  if (u.pathname.startsWith('/awscity-fixture/')) {
    const f = path.basename(u.pathname);
    return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', body: fixture(f) });
  }
  const svc = u.pathname.split('/')[1];
  const flow = FLOWS.find((f) => new URL(f.url).pathname.split('/')[1] === svc) ?? FLOWS[0];
  return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture(flow.file) });
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errors = [];

const city = await ctx.newPage();
city.on('pageerror', (e) => errors.push(`city: ${e.message}`));
await city.goto(`chrome-extension://${id}/city.html`);
await wait(2500);

const chip = (page, control) => page.locator(`[data-awscity-overlay] button[data-control="${control}"]`);
const results = [];

for (const [n, flow] of FLOWS.entries()) {
  const tab = await ctx.newPage();
  tab.on('pageerror', (e) => errors.push(`${flow.id}: ${e.message}`));
  await tab.goto(flow.url);
  await tab.bringToFront();
  await wait(1500);
  const focus = await city.evaluate(() => window.awsCity.useCity.getState().focus);
  console.log(`\n[${flow.id}] focus:`, focus?.kind, focus?.serviceId, 'tab', focus?.tabId);
  await city.evaluate((g) => window.awsCity.startConsoleCopilot(g), flow.goal);
  await tab.bringToFront();

  let shot = 0;
  const snap = async (label) => tab.screenshot({ path: `${out}/copilot-${flow.id}-${String(shot++).padStart(2, '0')}${label ? `-${label}` : ''}.png` });
  let created;
  const t0 = Date.now();
  let paused = false;
  let explained = false;
  let speedSet = false;
  let confirmed = false;
  while (Date.now() - t0 < 90_000) {
    await wait(1500);
    // The chip: set the speed once (persists to later flows), pause/resume once, explain again once.
    if (!speedSet && n === 0 && (await chip(tab, 'speed').count())) {
      await chip(tab, 'speed').click(); // normal → fast
      speedSet = true;
      console.log(`[${flow.id}] speed:`, await chip(tab, 'speed').textContent());
    }
    if (!paused && flow.id === 'dynamodb' && (await chip(tab, 'pause').count()) && Date.now() - t0 > 5000) {
      await chip(tab, 'pause').click();
      paused = true;
      await wait(2500); // anything already under way finishes
      const before = await tab.evaluate(() => document.getElementById('app').innerHTML);
      await snap('paused');
      await wait(5000);
      const after = await tab.evaluate(() => document.getElementById('app').innerHTML);
      console.log(`[${flow.id}] pause held the page still for 5 s:`, before === after);
      if (before !== after) errors.push(`${flow.id}: the agent acted while paused`);
      await chip(tab, 'pause').click(); // resume
    }
    if (!explained && flow.id === 'ec2' && (await chip(tab, 'explain').count())) {
      await chip(tab, 'explain').click();
      explained = true;
      await wait(300);
      await snap('explain');
    }
    // A step that bills (risk 'confirm') is handed to the player: play the player and click it.
    if (flow.confirm && !confirmed && (await tab.locator('[data-awscity-overlay]').getByText('needs your OK').count())) {
      await snap('your-turn');
      await tab.getByRole('button', { name: flow.confirm, exact: true }).click();
      confirmed = true;
      console.log(`[${flow.id}] player confirmed: ${flow.confirm}`);
    }
    if (shot < 14) await snap();
    created =await tab.evaluate(flow.created ?? (() => document.body.dataset.created));
    if (created) break;
  }
  // let the "done" step show, then check nothing risky was ever clicked
  await wait(2500);
  await snap('final');
  const risky = await tab.evaluate(() => document.body.dataset.risky ?? (document.body.innerText.includes('deleted') ? 'deleted' : ''));
  const ok = !!created && (!flow.expect || flow.expect.test(created)) && !risky && (!flow.confirm || confirmed);
  results.push({ flow: flow.id, created, risky: risky || 'none', ok });
  console.log(`[${flow.id}] created: ${created ?? '(nothing)'} · risky clicks: ${risky || 'none'} · ${ok ? 'OK' : 'FAIL'}`);
  const busy = await city.evaluate(() => window.awsCity.useCity.getState().copilotTaskId);
  if (busy) await city.evaluate(() => window.awsCity.stopConsoleCopilot());
  await tab.close();
}

const speed = await sw.evaluate(() => chrome.storage.local.get('copilotSpeed'));
console.log('\nstored speed:', JSON.stringify(speed));
await city.bringToFront();
await city.screenshot({ path: `${out}/copilot-city.png` });
const feed = await city.evaluate(() => window.awsCity.useCity.getState().feed.filter((f) => f.text.includes('🖱️')).map((f) => f.text.slice(0, 100)));
console.log('steps:\n  ' + feed.join('\n  '));
console.log(JSON.stringify(results));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
await ctx.close();
process.exit(results.every((r) => r.ok) && results.length === FLOWS.length && !errors.length ? 0 : 1);
