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
// Accessibility (WCAG 2.2 A/AA rules from axe-core) on what a player sees. The canvas is the game (its own keys and
// labels), so it's excluded. Serious and critical violations fail the smoke; the rest are listed.
const AXE = fs.readFileSync(path.resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const audit = async (where, p = page) => {
  await p.evaluate(AXE); // through DevTools, not a <script> tag: the extension's CSP blocks inline scripts
  const found = await p.evaluate(async () => {
    const r = await window.axe.run({ exclude: [['canvas']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, at: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) }));
  });
  for (const v of found) {
    const line = `${where}: a11y ${v.impact} ${v.id} ×${v.n} (${v.at.join(' | ')})`;
    console.log(line);
    if (v.impact === 'serious' || v.impact === 'critical') errors.push(line);
  }
  if (!found.length) console.log(`${where}: a11y clean`);
};

await page.goto(`chrome-extension://${id}/city.html`);
await wait(2500);
// A first run opens on the world map: pick a Region and dive into its city.
const startView = await city(() => window.awsCity.useCity.getState().view.name);
if (startView !== 'world') errors.push(`first run should open on the world map, got ${startView}`);
await wait(1500); // the world map fades in from the sea
await shot('00-world');
await audit('world map');
// Screenshots don't depend on the time of day the smoke runs: midday unless a shot asks for night.
await city(() => window.awsCity.bus.emit('hour', { hour: 12 }));
await page.mouse.click(10, 10); // a gesture, so sound may unlock (nothing should have queued)
// A first run's world map says one friendly line; the facts (AZs, opt-in, prices) wait behind "Facts ›" (the M key)
// until the player has a city, so M does nothing yet.
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowLeft'); // back to the suggested Region (us-west-2)
await page.keyboard.press('m');
await wait(300);
if (await page.locator('.home .next').count()) errors.push('first run: Home shows a quest card before a Region is picked (one call to action)');
await shot('00b-world-first');
// Connie offers the suggested Region: "Start in Oregon" dives into us-west-2.
const startBtn = page.locator('.world-intro button', { hasText: 'Start in Oregon' });
if (!(await startBtn.count())) errors.push('first run: Connie\'s "Start in Oregon" button is missing on the world map');
else await startBtn.click();
await wait(1500);
if ((await city(() => window.awsCity.useCity.getState().cityRegion)) !== 'us-west-2') errors.push('first run: "Start in Oregon" did not open us-west-2');
const firstTabs = await page.locator('.tabs button').evaluateAll((bs) => bs.map((b) => b.title));
if (firstTabs.join() !== 'Home,Quests') errors.push(`first run: tabs should start as Home and Quests, got ${firstTabs.join()}`);
await shot('01-start');

// A new player isn't flooded: the demo's findings arrive from 3 s on, but stay held until city care unlocks.
await wait(12_000);
const calm = await city(() => ({ findings: Object.keys(window.awsCity.useCity.getState().findings).length, toasts: window.awsCity.useCity.getState().toasts.length }));
console.log('calm city after 12 s:', JSON.stringify(calm));
if (calm.findings) errors.push(`calm city: ${calm.findings} findings shown before care unlocked`);
if (calm.toasts > 1) errors.push(`calm city: ${calm.toasts} toasts queued in the first seconds`);
await shot('01c-calm');

// City care: once released (a quest done, 4 landmarks or a linked account), findings drip in; a citizen walks to the first one.
await city(() => window.awsCity.releaseCare());
const careStart = Date.now();
while (Date.now() - careStart < 15_000 && !(await city(() => Object.keys(window.awsCity.useCity.getState().findings).length))) await wait(300);
const firstFinding = await city(() => Object.values(window.awsCity.useCity.getState().findings)[0]);
console.log('first finding:', firstFinding ? `${firstFinding.ruleId} on ${firstFinding.resource.name}` : 'none');
if (!firstFinding) errors.push('city care: no finding arrived in demo mode');
else {
  await wait(10_000); // the citizen's walk
  await city((id) => window.awsCity.bus.emit('showFinding', { findingId: id }), firstFinding.id);
  await wait(1200);
  await shot('19-city-care');
}

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
// The building's card: comparisons and the partners' Learn more shelf (links only, credited).
await city(() => (window.awsCity.useCity.getState().select('s3'), window.awsCity.bus.emit('select', { id: 's3' })));
await wait(1200);
const shelf = await page.$('.place-reading');
if (!shelf) errors.push('the S3 card has no Learn more shelf');
else {
  await shelf.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
  });
  await wait(300);
  await shot('02b-learn-more');
  await audit('place card');
}

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

await city(() => window.awsCity.useCity.getState().setView({ name: 'interior', districtId: 'spheres' }));
await wait(2500);
await shot('09b-spheres-interior');

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
await city(() => window.awsCity.bus.emit('hour', { hour: 12 }));
// The unlock ladder hides Learn, Places and Deploy from a new player. Seed a seasoned player's progress (every quest done
// but the last, so Quests still has an "Up next" card with "Start quest") before any of those tabs is clicked.
await city((seed) => {
  delete seed.quests['walled-garden'];
  window.awsCity.loadProgress(seed);
}, JSON.parse(fs.readFileSync('tests/fixtures/progress-all.json', 'utf8')));
await wait(800);
const seededTabs = await page.locator('.tabs button').evaluateAll((bs) => bs.map((b) => b.title));
if (seededTabs.join() !== 'Home,Quests,Learn,Places,Build') errors.push(`seeded progress: expected every tab, got ${seededTabs.join()}`);
// Learning modes
const clickTab = async (label) => page.locator(`.tabs button[title="${label}"]`).click();
await clickTab('Learn');
await wait(400);
await page.locator('.flash').click().catch(() => {});
await wait(300);
await shot('14-flashcards');
await page.locator('.seg button[data-sub="build"]').click();
// Architecture diagram: a refused drop first (a required card on a bonus spot), then follow the hints.
// The first hinted card is dragged with the mouse; the rest are tap card → tap spot.
const hintBtn = page.locator('.arch-row .btn');
await hintBtn.click(); // the free nudge
await hintBtn.click(); // show the card (−3)
await page.locator('.tray .card.hinted').click();
await page.locator('.slot.empty.opt').first().click();
await wait(150);
await shot('15a-architecture-reject');
await page.locator('.tray .card.armed').click(); // put it down again
for (let i = 0; i < 12 && (await hintBtn.isEnabled()); i++) {
  await hintBtn.click();
  if (!(await page.locator('.tray .card.hinted').count())) await hintBtn.click();
  const card = page.locator('.tray .card.hinted');
  const slot = page.locator('.slot.hinted');
  if (i === 0) {
    const a = await card.boundingBox();
    const b = await slot.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 - 20, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  } else {
    await card.click();
    await slot.click();
  }
}
await page.getByText('Check design').click();
await wait(500);
await shot('15-architecture');
await wait(1600);
await shot('15b-architecture-flow');
const arch = await page.evaluate(() => ({ flow: !!document.querySelector('.flow-bar'), filled: document.querySelectorAll('.slot.filled').length }));
console.log('architecture:', JSON.stringify(arch));
if (!arch.flow) errors.push('architecture: the design did not pass, so no flow played');
await clickTab('Quests');
await page.getByText('Start quest').first().click();
await wait(400);
await shot('16-quests');
await clickTab('Build');
// Demo mode: one primary button links the practice account; how real accounts connect is folded below it.
await page.getByText('Use the practice account (nothing real)').click();
await wait(1500);
await page.getByText('Preview').first().click();
await wait(3500);
await shot('17-deploy-preview');
await page.getByText('Approve & deploy').click();
await wait(8000);
await shot('18-deploy-done');

// City care: teach Noor to Fixer (as 20 flashcards would), open the city-built table's finding, and approve its fix in the card.
await city(() => window.awsCity.useCity.getState().awardCitizens([{ citizenId: 'citizen:reliability', amount: 20, reason: 'you reviewed 20 reliability flashcards' }]));
await clickTab('Home');
await wait(400);
await city(() => window.awsCity.releaseCare(true));
// City care is folded under its health line on Home; open it. The list shows the 3 most serious; the table's
// finding (medium) may be under "+N more".
await page.locator('.care-fold:not([open]) > summary').click().catch(() => {});
await page.locator('.care-more').click().catch(() => {});
await wait(200);
await shot('19-city-care-list');
const careRow = page.locator('.care-row', { hasText: 'point-in-time recovery' });
if (!(await careRow.count())) errors.push('city care: the PITR finding is not in the City care list');
else {
  await careRow.first().click();
  await wait(1500);
  await shot('19a-finding-card');
  await page.locator('.finding-card').getByRole('button', { name: 'Fix…' }).click();
  const approve = page.locator('.finding-card').getByRole('button', { name: 'Approve the fix' });
  await approve.waitFor({ timeout: 10_000 });
  await wait(600);
  await shot('19a2-fix-preview');
  const onDeploy = await page.locator('.tabs button[title="Build"][aria-selected="true"]').count();
  if (onDeploy) errors.push('city care: a fix preview switched to the Build tab');
  await approve.click();
  const fixStart = Date.now();
  const resolved = () => city(() => Object.values(window.awsCity.useCity.getState().findings).some((f) => f.ruleId === 'dynamodb-no-pitr' && f.status === 'resolved'));
  while (Date.now() - fixStart < 15_000 && !(await resolved())) await wait(300);
  if (!(await resolved())) errors.push('city care: the approved fix did not resolve the finding');
  const care = await city(() => {
    const s = window.awsCity.useCity.getState();
    return { noorXp: s.progress.citizens?.['citizen:reliability']?.xp, fixes: Object.keys(s.progress.fixes ?? {}).length, open: Object.values(s.findings).filter((f) => f.status === 'open').length };
  });
  console.log('city care:', JSON.stringify(care));
  await wait(900);
  await shot('19b-fixed');
  await page.locator('.finding-card').getByRole('button', { name: 'Close' }).click().catch(() => {});
}

// Regions: the world map with the demo account's cities and links, then another Region's city.
await city(() => window.awsCity.useCity.getState().openWorld());
await wait(1500);
await shot('20-world-links');
// The dive: Enter zooms into the focused Region and fades to the sea; the city pans in from the coast it came from.
await page.keyboard.press('Enter');
const diveAt = Date.now();
while (Date.now() - diveAt < 3000 && (await city(() => window.awsCity.useCity.getState().view.name)) !== 'city') await wait(50);
await wait(300); // ~300 ms into the 700 ms arrival pan
await shot('33-dive-arrive');
await wait(800);
await city(() => window.awsCity.useCity.getState().enterRegion('eu-west-1'));
await wait(1800);
await shot('21-city-eu-west-1');
// Each Region's city has its own landmark by the highway (shared/region-flavour.json signature).
for (const code of ['ap-northeast-1', 'ap-southeast-2', 'me-central-1', 'us-west-1']) {
  await city((c) => window.awsCity.useCity.getState().enterRegion(c), code);
  await wait(1500);
  await city(() => window.awsCity.bus.emit('flyTo', { id: 'signature' }));
  await wait(900);
  await shot(`27-sig-${code}`);
}
await city(() => window.awsCity.useCity.getState().enterRegion('eu-west-1'));
await wait(800);
await city(() => window.awsCity.useCity.getState().enterRegion('us-west-2'));
await wait(8000); // an AZ link plays over a bridge
await shot('22-az-bridges');

// Real Regions: N. Virginia's six AZ bands; a Region that doesn't offer every service (fenced lots); prices; the Region sign.
await city(() => window.awsCity.useCity.getState().enterRegion('us-east-1'));
await wait(1800);
await shot('23-us-east-1-six-azs');
await city(() => window.awsCity.useCity.getState().enterRegion('af-south-1'));
await wait(1500);
// Rekognition isn't offered in Cape Town: its landmark is a fenced lot, and its card says where it is.
// Selecting the way a tap does (the select moment opens the place card).
const pick = (id) => city((i) => (window.awsCity.useCity.getState().select(i), window.awsCity.bus.emit('select', { id: i })), id);
await city(() => window.awsCity.useCity.getState().discover('rekognition'));
await pick('rekognition');
await wait(1800);
await shot('24-closed-lot');
if (!(await page.locator('.region-price.closed').count())) errors.push('Rekognition in af-south-1 should show as not offered');
await pick('ec2');
await wait(1200);
await shot('25-price-card');
if (!(await page.locator('.region-price .prices').count())) errors.push('the EC2 card should show af-south-1 list prices');
await pick('regionsign');
await wait(1200);
await shot('26-region-sign');

// v2.6: AWS's public status. The demo plays the real dashboard (Bahrain and the UAE, 2026): a ticker over the city,
// Bahrain's city fenced and under rain, the incident's card, and the Region throbbing on the world map.
await city(() => (window.awsCity.useCity.getState().select(undefined), window.awsCity.useCity.getState().enterRegion('me-south-1')));
await wait(2500);
await shot('40-bahrain-storm');
if (!(await page.locator('.ticker').count())) errors.push('the AWS status ticker should show over the city');
await city(() => {
  const s = window.awsCity.useCity.getState();
  s.openIncident(s.health?.incidents.find((i) => i.region === 'me-south-1')?.id);
});
await wait(700);
await shot('41-incident-card');
if (!(await page.locator('.incident-card').count())) errors.push('the Bahrain incident card should open');
await page.keyboard.press('Escape');
await wait(300);
if (await page.locator('.incident-card').count()) errors.push('Escape should close the incident card');
await city(() => window.awsCity.useCity.getState().openWorld());
await wait(1500);
await shot('42-world-incidents');
await city(() => (window.awsCity.useCity.getState().select(undefined), window.awsCity.useCity.getState().enterRegion('us-west-2')));
await wait(1000);

// The first-run tour (skipped under automation; opened here through the store): 3 steps, the last starts the first job.
await city(() => window.awsCity.useCity.getState().setTourOpen(true));
await wait(700);
await shot('27-tour-1');
await page.locator('.tour-card [data-primary]').click();
await wait(400);
await page.locator('.tour-card [data-primary]').click();
await wait(500);
await shot('27b-tour-3');
const lastTourButton = await page.locator('.tour-card [data-primary]').textContent();
if (lastTourButton?.trim() !== 'Start my first job') errors.push(`tour: the last step's button reads "${lastTourButton}"`);
await page.keyboard.press('Escape');
await wait(300);

// side panel layout
const panel = await ctx.newPage();
panel.on('pageerror', (e) => errors.push(`panel pageerror: ${e.message}`));
await panel.setViewportSize({ width: 400, height: 820 });
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
await wait(2500);
await panel.evaluate(() => window.awsCity.bus.emit('hour', { hour: 12 })); // midday, as the tab's shots are
await wait(500);
await panel.screenshot({ path: `${out}/11-sidepanel.png` });
console.log('📸 11-sidepanel');
await audit('side panel', panel);
await panel.locator('.tabs button[title="Learn"]').click();
await panel.locator('.seg button[data-sub="build"]').click();
await wait(400);
await panel.locator('.diagram').scrollIntoViewIfNeeded();
await panel.screenshot({ path: `${out}/15c-architecture-panel.png` });
console.log('📸 15c-architecture-panel');
await panel.locator('.tabs button[title="Home"]').first().click().catch(() => {});

// Lookout: capture → upload (mock S3) → classify. Without a user gesture Chrome may refuse; either outcome is reported.
await panel.evaluate(() => window.awsCity.snap());
await wait(3500);
const snap = await panel.evaluate(() => {
  const s = window.awsCity.useCity.getState();
  return { snap: s.snap, hasShot: !!s.lastSnapshot, classified: s.lastClassified?.summary, lastLines: s.feed.slice(-3).map((f) => f.text) };
});
console.log('lookout:', JSON.stringify(snap));
await panel.screenshot({ path: `${out}/12-lookout.png` });

// ── City life (plan B3): traffic, boats, sky and the baseline packets, within the per-surface budget (plan B6) ──
{
  const caps = { tab: { citizens: 20, vehicles: 14, boats: 3, packets: 24, clouds: 3 }, panel: { citizens: 12, vehicles: 8, boats: 2, packets: 16, clouds: 2 } };
  const checkLife = (where, st, surface) => {
    if (!st) return errors.push(`${where}: window.awsCity.ambient.stats() returned nothing (is the city scene running?)`);
    const c = caps[surface];
    for (const k of ['citizens', 'vehicles', 'boats', 'packets', 'clouds']) if (st[k] > c[k]) errors.push(`${where}: ${st[k]} ${k} (cap ${c[k]})`);
    if (st.planes > 1 || st.flocks > 1) errors.push(`${where}: ${st.planes} planes, ${st.flocks} flocks (cap 1 each)`);
    if (st.headlights > 8) errors.push(`${where}: ${st.headlights} headlights (cap 8)`);
    if (st.data > st.caps.data) errors.push(`${where}: ${st.data} data carriers (cap ${st.caps.data})`);
    if (st.tweens >= 80) errors.push(`${where}: ${st.tweens} active tweens (budget < 80): ${JSON.stringify(st.tweenCensus ?? {})}`);
    if (st.children >= 4500) errors.push(`${where}: ${st.children} display objects (budget < 4,500)`);
    if (!st.reducedMotion && st.vehicles < 1) errors.push(`${where}: no traffic on the roads`);
    // Frame rate (game.loop.actualFps). Warns, never fails: headless Chromium paces requestAnimationFrame at 30 Hz (a
    // blank page measures 33 ms a frame), and the smoke runs the tab and the panel at once, so it reads low here.
    if (typeof st.fps === 'number') console.log(`${where}: ${st.fps} fps${st.fps < 45 ? '  ⚠ below 45 (headless caps rAF at 30)' : ''}`);
  };
  // Live traffic on (the demo account's request counts drive request cars in from the highway).
  await city(() => window.awsCity.setFlow(true));
  // Nothing selected, so Kai isn't still walking into an HQ picked earlier (the shot is the street).
  await city(() => (window.awsCity.useCity.getState().select(undefined), window.awsCity.useCity.getState().setView({ name: 'city' })));
  await city(() => window.awsCity.bus.emit('hour', { hour: 12 }));
  await wait(6000);
  await shot('30-traffic');
  await audit('city tab');
  // A data carrier's card (the demo's links drive as carriers; opened through the bus: a moving sprite is a poor click).
  await city(() => window.awsCity.bus.emit('carrierTap', { cargo: { kind: 'tanker', label: 'sessions table', route: '→ eu-west-1', cost: 'Data out to eu-west-1: $0.02 per GB' } }));
  await wait(400);
  await shot('32-carrier-card');
  await audit('carrier card');
  await page.keyboard.press('Escape');
  await wait(200);
  const tab = await city(() => ({ ...window.awsCity.ambient?.stats(), tweenCensus: window.awsCity.ambient?.tweens?.() }));
  console.log('city life (tab):', JSON.stringify(tab));
  checkLife('city life (tab)', tab, 'tab');
  await city(() => window.awsCity.bus.emit('hour', { hour: 22 }));
  await wait(2500);
  await shot('31-traffic-night');
  const night = await city(() => window.awsCity.ambient?.stats());
  console.log('city life (night):', JSON.stringify(night));
  checkLife('city life (night)', night, 'tab');
  await city(() => window.awsCity.bus.emit('hour', { hour: 12 }));
  const side = await panel.evaluate(() => window.awsCity.ambient?.stats()).catch(() => undefined);
  console.log('city life (panel):', JSON.stringify(side));
  if (side) checkLife('city life (panel)', side, side.surface);
}

console.log(errors.length ? `\n${errors.length} errors:\n` + errors.join('\n') : '\nno page errors');
await ctx.close();
