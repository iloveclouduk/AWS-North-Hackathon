// Opens a built AWS City in the browser the player picked. Shared by `npm start` and `npm run live`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { track } from './cleanup.mjs';
import { BROWSERS, extensionsPage, parseBuildProgress, parseDownloadProgress } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// npm/npx are .cmd scripts on Windows: spawn can only start them through a shell.
const WIN_SHELL = { shell: process.platform === 'win32' };
const OUT = { chrome: '.output/chrome-mv3', firefox: '.output/firefox-mv3', safari: '.output/safari-mv3' };
export const SAFARI_PROJECT = path.join(ROOT, '.cache/safari/AWS City/AWS City.xcodeproj');
const START_URL = 'https://console.aws.amazon.com/s3/home';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const browserById = (id) => BROWSERS.find((b) => b.id === id) ?? BROWSERS[0];

/** The command that runs the same build in the foreground, with all its output (said when a build fails). */
export const buildCommand = (browser) => ({ chrome: 'npm run build', firefox: 'npm run build:firefox', safari: 'npm run build:safari' })[browserById(browser).build];

/** Builds the extension for `browser` (WXT), with extra env (backend URLs, token). Returns false on failure. */
export const build = (browser, env = {}) =>
  spawnSync('npx', ['wxt', 'build', '-b', browserById(browser).build], { cwd: ROOT, env: { ...process.env, ...env }, stdio: env.QUIET ? 'ignore' : 'inherit', ...WIN_SHELL }).status === 0;

/**
 * Builds without blocking (so spinners keep moving), reporting WXT's stages as they happen.
 * Resolves { ok, seconds, tail } — `tail` is the last lines of output, shown when the build fails.
 */
export const buildAsync = (browser, env = {}, onProgress = () => {}) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = track(spawn('npx', ['wxt', 'build', '-b', browserById(browser).build], { cwd: ROOT, env: { ...process.env, ...env }, ...WIN_SHELL }));
    let log = '';
    let seconds;
    const read = (chunk) => {
      log = (log + chunk).slice(-20_000);
      for (const e of parseBuildProgress(chunk)) {
        if (e.done) seconds = e.seconds;
        onProgress(e);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', () => resolve({ ok: false, seconds: 0, tail: 'Could not start WXT (npx wxt).' }));
    child.on('close', (code) => {
      // eslint-disable-next-line no-control-regex
      const tail = log.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r|\n/).filter((l) => l.trim()).slice(-15).join('\n');
      resolve({ ok: code === 0, seconds: seconds ?? (Date.now() - started) / 1000, tail });
    });
  });

/** Is Playwright's Chrome for Testing downloaded? */
export const hasChromeForTesting = async () => {
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
};

/**
 * Opens the AWS City browser (Chrome for Testing) under the launcher's control: `ready` resolves with the
 * extension id once the city tab is up (undefined if it failed), `send('city' | 'practice' | 'console' | 'quit')`
 * drives the window, and `exited` resolves when the window is closed.
 */
export function launchControlled(env = process.env) {
  const child = track(spawn('node', ['scripts/open.mjs'], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] }));
  let out = '';
  // Its errors matter too (a missing browser, a crash): keep the end of both streams for the dashboard.
  child.stderr.on('data', (d) => (out = (out + d).slice(-8_000)));
  child.stdin.on('error', () => {}); // writing after it closed must not crash the launcher
  const ready = new Promise((resolve) => {
    child.stdout.on('data', (d) => {
      out = (out + d).slice(-8_000);
      const m = /READY (\w+)/.exec(out);
      if (m) resolve(m[1]);
    });
    // 'close', not 'exit': it waits for the output streams, so a last line (why it stopped) is never lost.
    child.on('close', () => resolve(undefined));
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return { child, ready, exited, send: (cmd) => child.stdin.writable && child.stdin.write(`${cmd}\n`), output: () => out };
}

/**
 * Downloads Chrome for Testing without blocking (the dashboard keeps animating). `onProgress({ fraction, total })`
 * follows Playwright's download; resolves { ok, output } (the output's end explains a failure).
 */
export const installChromeForTesting = (onProgress = () => {}) =>
  new Promise((resolve) => {
    const child = track(spawn('npx', ['playwright', 'install', 'chromium'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...WIN_SHELL }));
    let output = '';
    const read = (chunk) => {
      output = (output + chunk).slice(-8_000);
      const p = parseDownloadProgress(chunk);
      if (p) onProgress(p);
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (err) => resolve({ ok: false, output: String(err) }));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
  });

/**
 * Opens AWS City. Returns the child process to wait on, or undefined when the player finishes in their own browser.
 * `log(step, text)` shows a guidance line (the launcher animates them).
 * `firefoxPrefs` lets `npm run live` pin the add-on's internal UUID (exact-origin check on the local server).
 */
export async function openIn(id, { log = (_s, t) => console.log(t), firefoxPrefs = [], env = process.env, stdio = 'inherit' } = {}) {
  const b = browserById(id);
  if (b.id === 'cft') return track(spawn('node', ['scripts/open.mjs'], { cwd: ROOT, stdio, env }));

  if (b.id === 'firefox') {
    return track(spawn('npx', ['web-ext', 'run', '-s', OUT.firefox, ...firefoxPrefs.map((p) => `--pref=${p}`), '--start-url', START_URL], { cwd: ROOT, stdio, ...WIN_SHELL }));
  }

  if (b.id === 'safari') {
    spawnSync(
      'xcrun',
      ['safari-web-extension-converter', OUT.safari, '--project-location', '.cache/safari', '--app-name', 'AWS City', '--bundle-identifier', 'dev.awscity.AWS-City', '--macos-only', '--no-open', '--no-prompt', '--force'],
      { cwd: ROOT, stdio: 'ignore' },
    );
    spawnSync('open', [SAFARI_PROJECT]);
    const steps = [
      'Xcode opened: press ▶ Run (⌘R). A small "AWS City" app appears — that\'s the extension\'s container.',
      'Safari → Settings → Advanced → tick "Show features for web developers".',
      'Develop menu → "Allow Unsigned Extensions" (Safari asks again after every restart).',
      'Safari → Settings → Extensions → tick AWS City, then click its toolbar icon.',
    ];
    for (const [i, s] of steps.entries()) {
      log(i + 1, s);
      await sleep(250);
    }
    return undefined;
  }

  // Chrome, Edge, Brave: they no longer load extensions from the command line, so we hand over in three clicks.
  const dir = path.join(ROOT, OUT.chrome);
  const mac = process.platform === 'darwin';
  if (mac) {
    spawnSync('pbcopy', [], { input: dir });
    spawnSync('open', ['-a', b.app.replace(/\.app$/, ''), extensionsPage(b.id)]);
    spawnSync('open', ['-R', path.join(dir, 'manifest.json')]);
  }
  const steps = [
    mac ? `${b.name} opened ${extensionsPage(b.id)} (if not, type it in the address bar).` : `In ${b.name}, open ${extensionsPage(b.id)}.`,
    'Turn on "Developer mode" (top right).',
    mac ? 'Click "Load unpacked", press ⌘⇧G, paste (⌘V — the folder path is already copied) and click Open.' : `Click "Load unpacked" and pick ${dir}`,
    'Click the puzzle-piece (Extensions) icon, pin AWS City, then click the AWS City icon to open the city.',
    'Loaded it before? Just click ↻ (reload) on AWS City in the extensions page to pick up this build.',
  ];
  for (const [i, s] of steps.entries()) {
    log(i + 1, s);
    await sleep(250);
  }
  return undefined;
}
