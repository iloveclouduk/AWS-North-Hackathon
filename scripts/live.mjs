// Real mode: the AWS City server on this computer (your AWS account + Claude on Bedrock) + the extension wired to it.
// Easiest: `npm start` → "Real AWS" (it signs you in to AWS and checks Bedrock first, then runs this).
// Direct: npm run live [-- --browser cft|chrome|edge|brave|firefox|safari] [--profile <aws profile>] [--region <region>]
import './launcher/require-node.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { printBanner } from './launcher/banner.mjs';
import { BROWSERS, listProfiles, pickProfile, progressBar } from './launcher/lib.mjs';
import { liveConfig, SERVER_LOG, startServer } from './launcher/live-run.mjs';
import { browserById, buildAsync, hasChromeForTesting, openIn } from './launcher/open-browser.mjs';

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};
const OPTIONS = ['browser', 'profile', 'region'];
const opt = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) fail(`--${name} needs a value (npm run live -- --help).`);
  return v;
};

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`npm run live [-- options]   AWS City against real AWS: the local server + the extension wired to it

  --browser <id>    ${BROWSERS.map((b) => b.id).join(' | ')}   (default cft: the AWS City browser)
  --profile <name>  AWS profile (default: AWS_CITY_PROFILE, then aws-city, workshop, default)
  --region <name>   Bedrock + AWS region for the server (default: AWS_CITY_REGION or us-west-2)

Not signed in to AWS yet? Run  npm start  and pick "Real AWS": it connects your account and checks Bedrock.`);
  process.exit(0);
}
for (const a of process.argv.slice(2)) if (a.startsWith('--') && !OPTIONS.includes(a.slice(2))) fail(`Unknown option ${a} (npm run live -- --help).`);

printBanner();

// ── AWS profile: --profile, AWS_CITY_PROFILE, then aws-city / workshop / default ──
const read = (f) => (fs.existsSync(path.join(os.homedir(), '.aws', f)) ? fs.readFileSync(path.join(os.homedir(), '.aws', f), 'utf8') : '');
const profiles = listProfiles(read('credentials'), read('config'));
const profile = opt('profile') ?? pickProfile(profiles);
if (!profile || (!process.env.AWS_CITY_PROFILE && !opt('profile') && !profiles.includes(profile)))
  fail('No AWS sign-in on this computer yet.\n  Run  npm start  and pick "Real AWS": it connects AWS in one step (browser sign-in or pasted keys).');
// (A custom AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE isn't read here, so trust the name then.)
if (!profiles.includes(profile) && !process.env.AWS_CONFIG_FILE && !process.env.AWS_SHARED_CREDENTIALS_FILE) fail(`There's no AWS profile called "${profile}" in ~/.aws. Profiles here: ${profiles.join(', ') || 'none'}.`);
const region = opt('region') ?? process.env.AWS_CITY_REGION;
if (region && !/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(region)) fail(`--region ${region} doesn't look like an AWS region (e.g. us-west-2).`);

// ── browser ──
const target = opt('browser') ?? 'cft';
if (!BROWSERS.some((b) => b.id === target)) fail(`--browser ${target}: use ${BROWSERS.map((b) => b.id).join(', ')}`);
if (target === 'safari' && process.platform !== 'darwin') fail('Safari builds need macOS with Xcode.');
if (target === 'cft' && !(await hasChromeForTesting())) fail('The AWS City browser isn’t downloaded yet: run  npx playwright install chromium  (or use npm start).');
if (!fs.existsSync('server/node_modules')) {
  console.log('▶ installing the server’s packages (one time)…');
  const ok = spawnSync('npm', ['--prefix', 'server', 'ci', '--no-audit', '--no-fund', '--loglevel=error'], { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
  if (!ok) fail('Couldn’t install the server’s packages: run  cd server && npm ci  to see why.');
}

const cfg = liveConfig(target);

console.log(`▶ building AWS City for ${browserById(target).name}, wired to the local server…`);
const tty = process.stdout.isTTY;
const built = await buildAsync(target, cfg.extEnv, (e) => {
  if (!e.done && tty) process.stdout.write(`\r  🏗  ${progressBar(e.step / e.of)}  ${e.name} (${e.step}/${e.of})\x1b[K`);
});
if (tty) process.stdout.write('\r\x1b[K');
if (!built.ok) fail(`The extension build failed:\n${built.tail}`);
console.log(`  🏙  ${progressBar(1)}  City built in ${built.seconds.toFixed(1)} s`);

console.log(`▶ starting the AWS City server (AWS profile "${profile}"${region ? `, ${region}` : ''}, Claude on Bedrock)…`);
const server = startServer({ profile, region, cfg, onLog: (l) => console.log(`  server │ ${l}`) });
void server.exited.then((code) => {
  console.log(`server exited (${code}) — full log: ${SERVER_LOG}`);
  process.exit(code ?? 1);
});
if (!(await server.ready)) fail(`The server didn't come up in a minute. Log: ${SERVER_LOG}`);

console.log('▶ opening AWS City…');
const browser = await openIn(target, { log: (i, text) => console.log(`  ${i}. ${text}`), firefoxPrefs: cfg.firefoxPrefs, env: { ...process.env, ...cfg.extEnv } });
if (browser) browser.on('exit', () => server.stop());
else console.log('The server keeps running here; press Ctrl+C to stop it.');
process.on('SIGINT', () => (server.stop(), browser?.kill(), process.exit(0)));
