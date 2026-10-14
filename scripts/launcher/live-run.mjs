// Real-AWS mode, as functions: how the local server recognises each browser's build, and starting the server with
// its output captured. Used by `npm start` (dashboard) and `npm run live` (plain output).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_EXTENSION_ID, FIREFOX_ADDON_ID } from '../extension-id.mjs';
import { track } from './cleanup.mjs';
import { browserById } from './open-browser.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SERVER_LOG = path.join(ROOT, '.cache/server.log');

// Firefox gives each install a random moz-extension:// UUID; pinning it with a Firefox pref keeps the local server's
// exact-origin check. Safari's can't be pinned, so its build carries a one-off token for this run instead.
const FIREFOX_DEV_UUID = '6a1c0b5e-3c2d-4f7a-9b8e-a5c17c17c117';

/** Everything that ties one browser's build to the local server: origin, token, build env, Firefox prefs. */
export function liveConfig(browser, port = process.env.PORT ?? '8787') {
  const kind = browserById(browser).build;
  const token = kind === 'safari' ? randomBytes(24).toString('base64url') : undefined;
  const origin = {
    chrome: `chrome-extension://${process.env.AWS_CITY_EXTENSION_ID ?? DEV_EXTENSION_ID}`,
    firefox: `moz-extension://${FIREFOX_DEV_UUID}`,
    safari: 'safari-web-extension://*',
  }[kind];
  return {
    port,
    origin,
    token,
    url: `http://127.0.0.1:${port}`,
    extEnv: { WXT_BACKEND: 'aws', WXT_AWS_WS_URL: `ws://127.0.0.1:${port}/ws`, WXT_AWS_API_URL: `http://127.0.0.1:${port}`, ...(token ? { WXT_AWS_TOKEN: token } : {}) },
    firefoxPrefs: [`extensions.webextensions.uuids=${JSON.stringify({ [FIREFOX_ADDON_ID]: FIREFOX_DEV_UUID })}`],
  };
}

/** Is something already listening on this local port (e.g. an AWS City server left running elsewhere)? */
export const portBusy = (port, host = '127.0.0.1') =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (err) => resolve(err.code === 'EADDRINUSE' || err.code === 'EACCES'));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(Number(port), host);
  });

/**
 * Starts the AWS City server with the player's AWS profile. Its output goes to .cache/server.log and to `onLog`
 * line by line. `ready` resolves true once /health answers (false if it exits or takes over a minute).
 */
export function startServer({ profile, region, cfg, onLog = () => {} }) {
  mkdirSync(path.dirname(SERVER_LOG), { recursive: true });
  const file = createWriteStream(SERVER_LOG, { flags: 'w' });
  // Its own process group (not on Windows), so stopping it stops npm, tsx and the server under them together.
  const group = process.platform !== 'win32';
  const child = spawn('npm', ['start'], {
    cwd: path.join(ROOT, 'server'),
    shell: !group,
    detached: group,
    env: { ...process.env, AWS_CITY_PROFILE: profile, ...(region ? { AWS_CITY_REGION: region } : {}), EXTENSION_ORIGIN: cfg.origin, PORT: cfg.port, ...(cfg.token ? { AWS_CITY_TOKEN: cfg.token } : {}) },
  });
  let partial = '';
  const read = (chunk) => {
    file.write(chunk);
    const lines = (partial + chunk).split('\n');
    partial = lines.pop() ?? '';
    // eslint-disable-next-line no-control-regex
    for (const l of lines) if (l.trim()) onLog(l.replace(/\x1b\[[0-9;]*m/g, '').trim());
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  const exited = new Promise((resolve) => child.on('exit', resolve));
  const ready = (async () => {
    let gone = false;
    void exited.then(() => (gone = true));
    for (let i = 0; i < 60 && !gone; i++) {
      try {
        if ((await fetch(`${cfg.url}/health`)).ok) return true;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  })();
  const stop = () => {
    try {
      if (group) process.kill(-child.pid, 'SIGTERM');
      else child.kill();
    } catch {
      child.kill();
    }
  };
  track(child, stop);
  return { child, ready, exited, stop };
}
