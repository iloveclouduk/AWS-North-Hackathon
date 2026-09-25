// Loads the built extension into Playwright's Chromium and screenshots the key moments.
// Usage: npm run build && node scripts/smoke.mjs [outDir]   (needs `npm i -D playwright && npx playwright install chromium`)
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ext = path.resolve('.output/chrome-mv3');
const out = path.resolve(process.argv[2] ?? '.output/smoke');
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'awscity-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1400, height: 880 },
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
console.log('extension id', id);

const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => (errors.push(`pageerror: ${e.message}`), console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 4).join(' | '))));
page.on('console', (m) => m.type() === 'error' && (errors.push(`console: ${m.text()}`), console.log('CONSOLE', m.text().slice(0, 400))));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('📸', name);
};
const city = (fn, ...a) => page.evaluate(fn, ...a);

await page.goto(`chrome-extension://${id}/city.html`);
await wait(2500);
await shot('01-start');

// Real browsing: a tab on AWS docs should reach the city via background.ts → runtime message.
const tab = await ctx.newPage();
await tab.goto('https://docs.aws.amazon.com/lambda/latest/dg/welcome.html', { waitUntil: 'commit' }).catch((e) => console.log('docs nav failed (offline?)', e.message));
await wait(2500);
const focus = await city(() => window.awsCity.useCity.getState().focus);
console.log('focus from background:', JSON.stringify(focus && { kind: focus.kind, serviceId: focus.serviceId, url: focus.url.slice(0, 60) }));
await tab.close();
await page.bringToFront();

await city(() => window.awsCity.simulateFocus('https://console.aws.amazon.com/console/home', 'Console Home'));
await wait(1500);
await city(() => window.awsCity.simulateFocus('https://eu-west-2.console.aws.amazon.com/s3/buckets?region=eu-west-2', 'S3 buckets'));
await wait(4500);
await shot('02-s3-discovered');

await city(() => window.awsCity.submitPrompt('Store my holiday photos cheaply'));
await wait(3500);
await shot('03-task-dispatch');
await wait(6000);
await shot('04-task-walking-working');
await wait(9000);
await shot('05-task-steps');
await wait(9000);
await shot('06-task-done');

// level everything up a bit for a fuller city
await city(() => {
  const s = window.awsCity.useCity.getState();
  for (const [id, xp] of [['s3', 60], ['lambda', 120], ['iam', 12], ['route53', 45], ['dynamodb', 210], ['shield', 110], ['bedrock', 45], ['ecs', 40], ['vpc', 20], ['efs', 0], ['aurora', 110], ['rekognition', 0]]) s.addXp(id, xp || 1);
});
await wait(2500);
await city(() => {
  const cam = document.querySelector('canvas');
  return !!cam;
});
await page.mouse.wheel(0, 400);
await wait(800);
await shot('07-city-grown');

await city(() => window.awsCity.useCity.getState().setView({ name: 'interior', districtId: 'storage' }));
await wait(2000);
await city(() => window.awsCity.askDistrict('storage', 'When should I use EFS?'));
await wait(1200);
await shot('08-interior-working');
await wait(5000);
await shot('09-interior-answer');

await city(() => window.awsCity.useCity.getState().setView({ name: 'game', game: 'fishing' }));
await wait(1500);
await shot('10-fishing');
for (const g of ['shield', 'route53', 'lambda']) {
  await city((game) => window.awsCity.useCity.getState().setView({ name: 'game', game }), g);
  await wait(3500);
  await shot(`10-game-${g}`);
}
await city(() => window.awsCity.useCity.getState().setView({ name: 'city' }));
await wait(1200);
// Night time + keyboard: Kai walks with the arrow keys
await city(() => window.awsCity.bus.emit('hour', { hour: 22 }));
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
await wait(1500);
await shot('13-night');
await city(() => window.awsCity.bus.emit('hour', { hour: undefined }));
// Learning modes
const clickTab = async (label) => page.locator(`.tabs button[title="${label}"]`).click();
await clickTab('Cards');
await wait(400);
await page.locator('.flash').click().catch(() => {});
await wait(300);
await shot('14-flashcards');
await clickTab('Build');
await page.locator('.palette .svc').first().click();
await page.locator('.palette .svc').first().click();
await page.getByText('Check design').click();
await wait(400);
await shot('15-architecture');
await clickTab('Quests');
await page.getByText('Start quest').first().click();
await wait(400);
await shot('16-quests');
await clickTab('Deploy');
await page.getByText('Get my setup link').click();
await wait(300);
await page.getByText('use demo role').click();
await wait(1500);
await page.getByText('Preview').first().click();
await wait(3500);
await shot('17-deploy-preview');
await page.getByText('Approve & deploy').click();
await wait(8000);
await shot('18-deploy-done');

// side panel layout
const panel = await ctx.newPage();
panel.on('pageerror', (e) => errors.push(`panel pageerror: ${e.message}`));
await panel.setViewportSize({ width: 400, height: 820 });
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
await wait(3000);
await panel.screenshot({ path: `${out}/11-sidepanel.png` });
console.log('📸 11-sidepanel');

// Lookout: capture → upload (mock S3) → classify. Without a user gesture Chrome may refuse; either outcome is reported.
await panel.evaluate(() => window.awsCity.snap());
await wait(3500);
const snap = await panel.evaluate(() => {
  const s = window.awsCity.useCity.getState();
  return { snap: s.snap, hasShot: !!s.lastSnapshot, classified: s.lastClassified?.summary, lastLines: s.feed.slice(-3).map((f) => f.text) };
});
console.log('lookout:', JSON.stringify(snap));
await panel.screenshot({ path: `${out}/12-lookout.png` });

console.log(errors.length ? `\n${errors.length} errors:\n` + errors.join('\n') : '\nno page errors');
await ctx.close();
