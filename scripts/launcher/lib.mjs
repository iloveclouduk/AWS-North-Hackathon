// Pure helpers for `npm start` (scripts/start.mjs). No prompts or side effects here, so they're unit-tested
// (tests/launcher.test.ts).
import path from 'node:path';

/** Browsers AWS City can open in. `cft` is Playwright's Chrome for Testing, the one that loads the extension by itself. */
export const BROWSERS = [
  { id: 'cft', name: 'AWS City browser', hint: 'Chrome for Testing — opens with AWS City already loaded', build: 'chrome', auto: true },
  { id: 'chrome', name: 'Google Chrome', app: 'Google Chrome.app', build: 'chrome', auto: false },
  { id: 'edge', name: 'Microsoft Edge', app: 'Microsoft Edge.app', build: 'chrome', auto: false },
  { id: 'brave', name: 'Brave', app: 'Brave Browser.app', build: 'chrome', auto: false },
  { id: 'firefox', name: 'Firefox', app: 'Firefox.app', build: 'firefox', auto: true },
  { id: 'safari', name: 'Safari', app: 'Safari.app', build: 'safari', auto: false },
];

/** Which browsers are installed (macOS /Applications); Chrome for Testing is always offered (it's installable). */
export const detectBrowsers = (exists, { platform = process.platform, appDirs = ['/Applications', path.join(process.env.HOME ?? '', 'Applications')] } = {}) =>
  BROWSERS.filter((b) => {
    if (b.id === 'cft') return true;
    // Outside macOS, offer Firefox when its command exists; Chrome-family browsers use the AWS City browser.
    if (platform !== 'darwin') return b.id === 'firefox' && exists('firefox');
    return appDirs.some((d) => exists(path.join(d, b.app)));
  });

/** Where Chrome-family browsers list extensions (for the "Load unpacked" steps). */
export const extensionsPage = (id) => ({ edge: 'edge://extensions', brave: 'brave://extensions' })[id] ?? 'chrome://extensions';

/** Profile names in ~/.aws/credentials and ~/.aws/config. */
export const listProfiles = (credentials = '', config = '') => {
  const names = new Set();
  for (const m of credentials.matchAll(/^\s*\[([^\]]+)\]/gm)) names.add(m[1].trim());
  for (const m of config.matchAll(/^\s*\[(?:profile\s+)?([^\]]+)\]/gm)) if (!m[1].startsWith('sso-session') && !m[1].startsWith('services')) names.add(m[1].trim());
  return [...names];
};

/** The profile AWS City uses: explicit choice, then the ones our tools create, then the usual default. */
export const pickProfile = (profiles, env = process.env) => {
  if (env.AWS_CITY_PROFILE) return env.AWS_CITY_PROFILE;
  return ['aws-city', 'workshop', 'default'].find((p) => profiles.includes(p));
};

/**
 * Adds or replaces one profile in a credentials file's text, leaving every other profile untouched.
 * Keys are written as given; callers never log them.
 */
export const upsertProfile = (text, name, { accessKeyId, secretAccessKey, sessionToken }) => {
  const block = [`[${name}]`, `aws_access_key_id = ${accessKeyId}`, `aws_secret_access_key = ${secretAccessKey}`, ...(sessionToken ? [`aws_session_token = ${sessionToken}`] : [])].join('\n');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `[${name}]`);
  if (start === -1) return `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${block}\n`;
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end === -1) end = lines.length;
  return [...lines.slice(0, start), block, ...(end < lines.length ? ['', ...lines.slice(end)] : [])].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
};

/**
 * Reads the keys pasted from Workshop Studio / the AWS access portal: either the `export AWS_…=…` lines, the
 * `[profile]` block, or nothing (then ask one by one).
 */
export const parsePastedKeys = (text) => {
  const get = (...names) => {
    for (const n of names) {
      const m = new RegExp(`(?:^|\\s)(?:export\\s+|set\\s+|\\$Env:)?${n}\\s*=\\s*"?([^"\\s]+)"?`, 'im').exec(text);
      if (m) return m[1];
    }
    return undefined;
  };
  const accessKeyId = get('AWS_ACCESS_KEY_ID', 'aws_access_key_id');
  const secretAccessKey = get('AWS_SECRET_ACCESS_KEY', 'aws_secret_access_key');
  const sessionToken = get('AWS_SESSION_TOKEN', 'aws_session_token');
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, sessionToken } : undefined;
};

/** Plain-language fixes for the errors people actually hit. */
export const explainAwsError = (err) => {
  const name = err?.name ?? '';
  const msg = String(err?.message ?? err);
  if (/ExpiredToken|RequestExpired|token.*expired/i.test(name + msg)) return 'Those AWS keys have expired. Get fresh ones (Workshop Studio → "Get AWS CLI credentials") or sign in again.';
  if (/InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient/i.test(name + msg)) return "AWS didn't accept those keys. Check you copied all of them (including the session token for temporary keys).";
  if (/could not load credentials|CredentialsProviderError|no credentials/i.test(name + msg)) return 'No AWS sign-in found yet.';
  if (/AccessDenied/i.test(name + msg)) return 'Signed in, but this account is not allowed to do that.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|timed? ?out/i.test(msg)) return "Couldn't reach AWS. Check your internet connection.";
  return msg.split('\n')[0].slice(0, 200);
};

/** Friendly names for WXT's build stages (the extension's entrypoints). */
const STAGES = [
  [/background/, 'wiring the power grid'],
  [/city|sidepanel/, 'laying the roads'],
  [/console/, 'building the bridge to the AWS console'],
];

/**
 * Reads WXT build output ("⠋ [2/3] city, sidepanel", "✔ Built extension in 2.938 s") into progress events,
 * so the launcher can show a real progress bar. Unknown lines yield nothing.
 */
export const parseBuildProgress = (chunk) => {
  // eslint-disable-next-line no-control-regex
  const text = String(chunk).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '\n');
  const events = [];
  for (const m of text.matchAll(/\[(\d+)\/(\d+)\]\s*([^\n[]+)/g)) {
    const label = m[3].trim();
    events.push({ step: Number(m[1]), of: Number(m[2]), label, name: STAGES.find(([re]) => re.test(label))?.[1] ?? `building ${label}` });
  }
  const done = /Built extension in ([\d.]+)\s*(ms|s)/.exec(text);
  if (done) events.push({ done: true, seconds: done[2] === 'ms' ? Number(done[1]) / 1000 : Number(done[1]) });
  return events;
};

/** A little construction bar: ▰ for finished work, ▱ for what's left. */
export const progressBar = (fraction, width = 12) => {
  const full = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return `${'▰'.repeat(full)}${'▱'.repeat(width - full)}`;
};

/** Elapsed time for the step list: "0.8 s", "12.3 s", "1 min 05 s". */
export const elapsed = (ms) => {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
};

/** Reads Playwright's download progress ("|■■■■    |  40% of 150.2 MiB") from `playwright install` output. */
export const parseDownloadProgress = (chunk) => {
  const all = [...String(chunk).matchAll(/(\d+)% of ([\d.]+ [KMG]i?B)/g)];
  const m = all.at(-1);
  return m ? { fraction: Number(m[1]) / 100, total: m[2] } : undefined;
};

/** Why downloading Chrome for Testing failed, in a sentence, from `playwright install` output. */
export const explainDownloadError = (output = '') => {
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|socket hang up|server closed connection/i.test(output))
    return "Couldn't download Chrome for Testing: no internet connection.";
  if (/ENOSPC|no space left/i.test(output)) return "Couldn't download Chrome for Testing: the disk is full.";
  if (/EACCES|EPERM|permission denied/i.test(output)) return "Couldn't save Chrome for Testing: permission denied in Playwright's browser folder.";
  return "Couldn't download Chrome for Testing.";
};

// ── command line ─────────────────────────────────────────────────────────────
const BROWSER_ALIASES = { city: 'cft', 'aws-city': 'cft', 'chrome-for-testing': 'cft', chromium: 'cft' };
/** A browser id from what someone typed ("chrome", "Edge", "city"), or undefined. */
export const browserFromArg = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  const id = BROWSER_ALIASES[v] ?? v;
  return BROWSERS.some((b) => b.id === id) ? id : undefined;
};

/**
 * `npm start` flags → { help, mode?, browser?, intro, error? }. Pure, so it's unit-tested.
 * `npm start --demo` (no `--`) never reaches argv: npm keeps it as npm_config_demo, so that's read too.
 */
export const parseArgs = (argv, env = {}) => {
  const out = { help: false, intro: true };
  const fail = (error) => ({ ...out, error });
  let args = [...argv];
  if (!args.length && env.npm_lifecycle_event === 'start') {
    if (env.npm_config_demo === 'true') args.push('--demo');
    if (env.npm_config_live === 'true') args.push('--live');
    if (env.npm_config_intro === 'false') args.push('--no-intro');
    if (env.npm_config_browser === 'true') return fail('npm kept the browser name for itself: put -- before the flags, e.g. npm start -- --demo --browser chrome');
    if (env.npm_config_browser) args.push('--browser', env.npm_config_browser);
  }
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].startsWith('--') && args[i].includes('=') ? [args[i].slice(0, args[i].indexOf('=')), args[i].slice(args[i].indexOf('=') + 1)] : [args[i], undefined];
    if (flag === '-h' || flag === '--help') out.help = true;
    else if (flag === '--demo' || flag === '--live') {
      const mode = flag.slice(2);
      if (out.mode && out.mode !== mode) return fail('Pick one: --demo or --live.');
      out.mode = mode;
    } else if (flag === '--no-intro') out.intro = false;
    else if (flag === '--browser' || flag === '-b') {
      const value = inline ?? args[++i];
      if (!value || value.startsWith('-')) return fail('--browser needs a name, e.g. --browser chrome');
      const id = browserFromArg(value);
      if (!id) return fail(`Unknown browser "${value}".`);
      out.browser = id;
    } else return fail(`Unknown option "${args[i]}".`);
  }
  return out;
};

const HELP_NOTES = {
  cft: 'AWS City browser (Chrome for Testing): opens with AWS City loaded, zero clicks (also: city)',
  firefox: 'Firefox (opens with AWS City loaded)',
  safari: 'Safari (the full city in a tab; needs Xcode)',
};
/** `npm start -- --help`. */
export const helpText = () =>
  [
    'AWS City: npm start',
    '',
    'Run it with no options and it asks how you want to play and which browser to use.',
    'Options skip the questions (put -- after npm start so npm passes them on):',
    '',
    '  --demo               play the demo: a practice account, nothing touches AWS',
    '  --live               real AWS on this computer (asks to sign in only if it has to)',
    '  --browser <name>     open in this browser:',
    ...BROWSERS.map((b) => `                         ${b.id.padEnd(9)}${HELP_NOTES[b.id] ?? `${b.name} (3 guided clicks the first time)`}`),
    '  --no-intro           skip the title animation',
    '  -h, --help           show this help',
    '',
    'Examples:',
    '  npm start -- --demo --browser cft        straight to the demo, zero clicks',
    '  npm start -- --demo --browser chrome     the demo in Google Chrome (load it once from chrome://extensions)',
    '  npm start -- --live --browser firefox    real AWS in Firefox',
    '',
    'Without --browser it uses the browser you picked last time (or the AWS City browser).',
  ].join('\n');

// ── a Chrome for Testing window that's already open ─────────────────────────────────────────────
// Chrome keeps one running instance per profile folder, marked by its SingletonLock symlink ("host-PID"). A second
// launch on the same folder hands over to the open window and exits at once, which Playwright reports only as
// "browser has been closed". scripts/open.mjs checks the lock first and says so plainly instead.

/** The pid in a SingletonLock target such as "Salmans-MacBook-Air.local-74762". */
export const lockPid = (target) => {
  const m = /-(\d+)$/.exec(String(target ?? '').trim());
  return m ? Number(m[1]) : undefined;
};

/** The line scripts/open.mjs prints when the profile is already open (start.mjs reads it back). */
export const ALREADY_OPEN = 'AWS_CITY_ALREADY_OPEN';
export const alreadyOpenPid = (output = '') => {
  const m = new RegExp(`${ALREADY_OPEN} (\\d+)`).exec(output);
  return m ? Number(m[1]) : undefined;
};

/** Playwright's and Node's closing noise: never the reason a browser didn't start. */
const NOISE = /temporary directories cleanup|<gracefully close|^Node\.js v|^\s*[\]}]\s*$|^\s*at .+:\d+:\d+\)?$/;
const REASON = /Error|has been closed|existing browser session|ProcessSingleton|Executable doesn't exist|already open|EACCES|ENOENT/i;

/** The lines worth showing from a failed launch: the first one that says why (and the next two), else the tail. */
export const meaningfulLines = (output = '', max = 6) => {
  const lines = String(output).split('\n').filter((l) => l.trim() && !NOISE.test(l) && !l.includes(ALREADY_OPEN));
  const i = lines.findIndex((l) => REASON.test(l));
  return (i >= 0 ? lines.slice(i, i + 3) : lines.slice(-max)).map((l) => l.trim().slice(0, 200));
};
