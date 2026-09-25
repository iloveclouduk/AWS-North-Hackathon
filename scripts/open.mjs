// Opens a real (headed) Chromium window with AWS City loaded — branded Chrome ignores --load-extension.
// Usage: npm run open   (keeps progress in .cache/chrome-profile between runs)
import { chromium } from 'playwright';
import path from 'node:path';

const ext = path.resolve('.output/chrome-mv3');
const ctx = await chromium.launchPersistentContext(path.resolve('.cache/chrome-profile'), {
  channel: 'chromium',
  headless: false,
  viewport: null,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=1500,950'],
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
console.log(`AWS City loaded (extension id ${id}). Close the window to stop.`);

// A safe practice page for the Console Copilot: this one console URL is served locally (a stand-in for the
// S3 "Create bucket" page). Every other console URL is the real AWS console.
const DEMO = 'https://us-west-2.console.aws.amazon.com/s3/aws-city-demo';
const fs = await import('node:fs');
await ctx.route(`${DEMO}*`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync('tests/fixtures/s3-console.html', 'utf8') }));
const [first] = ctx.pages();
const demo = first ?? (await ctx.newPage());
await demo.goto(DEMO).catch(() => {});
const real = await ctx.newPage();
await real.goto('https://console.aws.amazon.com/s3/home').catch(() => {});
const city = await ctx.newPage();
await city.goto(`chrome-extension://${id}/city.html`);
city.on('pageerror', (e) => console.log('page error:', e.message));

await new Promise((resolve) => ctx.on('close', resolve));
