// Real mode: the team's server (real workshop AWS account + Claude on Bedrock) + the extension wired to it.
// Needs workshop keys in ~/.aws/credentials under [workshop] (see README → "Real mode").
// Usage: npm run live
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const credsFile = path.join(os.homedir(), '.aws', 'credentials');
const profile = process.env.AWS_CITY_PROFILE ?? 'workshop';
if (!fs.existsSync(credsFile) || !fs.readFileSync(credsFile, 'utf8').includes(`[${profile}]`)) {
  console.error(`\n✗ No [${profile}] profile in ${credsFile}.\n  Add your Workshop Studio keys there first (README → "Real mode"), then run: npm run live\n`);
  process.exit(1);
}

// The unpacked extension's id is derived from its folder path, so it is stable on this machine.
const EXT_ID = process.env.AWS_CITY_EXTENSION_ID ?? 'bfmjkijhblakkkkpejochcffebmbkdff';
const PORT = process.env.PORT ?? '8787';
const env = { ...process.env, WXT_BACKEND: 'aws', WXT_AWS_WS_URL: `ws://127.0.0.1:${PORT}/ws`, WXT_AWS_API_URL: `http://127.0.0.1:${PORT}` };

console.log('▶ building the extension for the real server…');
execSync('npx wxt build', { stdio: 'inherit', env });

console.log('▶ starting the AWS City server (real AWS + Bedrock)…');
const server = spawn('npm', ['start'], { cwd: 'server', env: { ...process.env, EXTENSION_ORIGIN: `chrome-extension://${EXT_ID}`, PORT }, stdio: 'inherit' });
server.on('exit', (code) => {
  console.log(`server exited (${code})`);
  process.exit(code ?? 1);
});

for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('▶ opening AWS City…');
const browser = spawn('node', ['scripts/open.mjs'], { stdio: 'inherit', env });
browser.on('exit', () => server.kill());
process.on('SIGINT', () => (server.kill(), browser.kill(), process.exit(0)));
