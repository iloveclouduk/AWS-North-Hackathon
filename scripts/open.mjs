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

const [first] = ctx.pages();
const docs = first ?? (await ctx.newPage());
await docs.goto('https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html').catch(() => {});
const city = await ctx.newPage();
await city.goto(`chrome-extension://${id}/city.html`);
city.on('pageerror', (e) => console.log('page error:', e.message));

await new Promise((resolve) => ctx.on('close', resolve));
