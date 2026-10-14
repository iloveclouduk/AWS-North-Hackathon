import { describe, expect, it } from 'vitest';
import { frame, INTRO_SECONDS, vehicle } from '../scripts/launcher/banner.mjs';
import { renderDashboard, wrap, type DashState } from '../scripts/launcher/dashboard.mjs';
import {
  browserFromArg,
  detectBrowsers,
  elapsed,
  explainAwsError,
  explainDownloadError,
  extensionsPage,
  helpText,
  listProfiles,
  parseArgs,
  parseBuildProgress,
  parseDownloadProgress,
  parsePastedKeys,
  pickProfile,
  progressBar,
  upsertProfile,
} from '../scripts/launcher/lib.mjs';

describe('npm start helpers', () => {
  it('offers the browsers that are installed (and always the AWS City browser)', () => {
    const installed = new Set(['/Applications/Google Chrome.app', '/Applications/Safari.app']);
    const ids = detectBrowsers((p) => installed.has(p), { platform: 'darwin', appDirs: ['/Applications'] }).map((b) => b.id);
    expect(ids).toEqual(['cft', 'chrome', 'safari']);
    expect(detectBrowsers(() => false, { platform: 'linux' }).map((b) => b.id)).toEqual(['cft']);
    expect(extensionsPage('edge')).toBe('edge://extensions');
  });

  it('finds profiles and picks the one AWS City should use', () => {
    const creds = '[default]\naws_access_key_id = A\n\n[workshop]\naws_access_key_id = B\n';
    const config = '[profile aws-city]\nlogin_session = x\n[sso-session corp]\nsso_region = us-east-1\n';
    const profiles = listProfiles(creds, config);
    expect(profiles).toEqual(['default', 'workshop', 'aws-city']);
    expect(pickProfile(profiles, {})).toBe('aws-city');
    expect(pickProfile(['default'], {})).toBe('default');
    expect(pickProfile(['default'], { AWS_CITY_PROFILE: 'mine' })).toBe('mine');
    expect(pickProfile([], {})).toBeUndefined();
  });

  it('saves pasted keys as one profile without touching the others', () => {
    const before = '[default]\naws_access_key_id = KEEP\naws_secret_access_key = KEEP\n\n[aws-city]\naws_access_key_id = OLD\naws_secret_access_key = OLD\naws_session_token = OLD\n\n[other]\nregion = eu-west-1\n';
    const after = upsertProfile(before, 'aws-city', { accessKeyId: 'NEW', secretAccessKey: 'S' });
    expect(after).toContain('[default]\naws_access_key_id = KEEP');
    expect(after).toContain('[aws-city]\naws_access_key_id = NEW\naws_secret_access_key = S\n');
    expect(after).not.toContain('OLD');
    expect(after).toContain('[other]\nregion = eu-west-1');
    expect(upsertProfile('', 'aws-city', { accessKeyId: 'A', secretAccessKey: 'B', sessionToken: 'T' })).toBe('[aws-city]\naws_access_key_id = A\naws_secret_access_key = B\naws_session_token = T\n');
  });

  it('understands keys pasted from Workshop Studio (export lines) or a profile block', () => {
    expect(parsePastedKeys('export AWS_ACCESS_KEY_ID="ASIA1"\nexport AWS_SECRET_ACCESS_KEY="s/2+x"\nexport AWS_SESSION_TOKEN="tok=="')).toEqual({ accessKeyId: 'ASIA1', secretAccessKey: 's/2+x', sessionToken: 'tok==' });
    expect(parsePastedKeys('[default]\naws_access_key_id=AKIA9\naws_secret_access_key=abc')).toEqual({ accessKeyId: 'AKIA9', secretAccessKey: 'abc', sessionToken: undefined });
    expect(parsePastedKeys('hello')).toBeUndefined();
  });

  it('turns AWS errors into a next step', () => {
    expect(explainAwsError({ name: 'ExpiredTokenException', message: 'x' })).toMatch(/expired/);
    expect(explainAwsError({ name: 'CredentialsProviderError', message: 'Could not load credentials from any providers' })).toMatch(/No AWS sign-in/);
  });
});

describe('npm start options (the stage one-liner)', () => {
  it('skips the questions with --demo / --live and --browser', () => {
    expect(parseArgs([])).toEqual({ help: false, intro: true });
    expect(parseArgs(['--demo', '--browser', 'chrome'])).toEqual({ help: false, intro: true, mode: 'demo', browser: 'chrome' });
    expect(parseArgs(['--live', '--browser=firefox', '--no-intro'])).toEqual({ help: false, intro: false, mode: 'live', browser: 'firefox' });
    expect(parseArgs(['-b', 'Edge']).browser).toBe('edge');
    expect(parseArgs(['--browser', 'city']).browser).toBe('cft');
    expect(parseArgs(['--browser', 'safari']).browser).toBe('safari');
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(browserFromArg('nope')).toBeUndefined();
  });

  it('refuses what it does not understand (the launcher then prints help and exits 1)', () => {
    expect(parseArgs(['--bogus']).error).toMatch(/Unknown option "--bogus"/);
    expect(parseArgs(['demo']).error).toMatch(/Unknown option/);
    expect(parseArgs(['--browser']).error).toMatch(/needs a name/);
    expect(parseArgs(['--browser', '--demo']).error).toMatch(/needs a name/);
    expect(parseArgs(['--browser', 'netscape']).error).toMatch(/Unknown browser "netscape"/);
    expect(parseArgs(['--demo', '--live']).error).toMatch(/Pick one/);
  });

  it('understands npm start --demo without the -- (npm keeps those flags as npm_config_*)', () => {
    const npm = { npm_lifecycle_event: 'start' };
    expect(parseArgs([], { ...npm, npm_config_demo: 'true' })).toEqual({ help: false, intro: true, mode: 'demo' });
    expect(parseArgs([], { ...npm, npm_config_live: 'true', npm_config_browser: 'firefox' })).toMatchObject({ mode: 'live', browser: 'firefox' });
    // `npm start --demo --browser chrome` loses "chrome": say how to pass it instead of guessing.
    expect(parseArgs([], { ...npm, npm_config_demo: 'true', npm_config_browser: 'true' }).error).toMatch(/npm start -- --demo --browser chrome/);
    // Only for npm start, and argv wins.
    expect(parseArgs([], { npm_config_demo: 'true' })).toEqual({ help: false, intro: true });
    expect(parseArgs(['--live'], { ...npm, npm_config_demo: 'true' }).mode).toBe('live');
  });

  it('lists every browser and the stage one-liner in --help', () => {
    const help = helpText();
    for (const id of ['cft', 'chrome', 'edge', 'brave', 'firefox', 'safari']) expect(help).toContain(`  ${id} `);
    expect(help).toContain('npm start -- --demo --browser chrome');
  });
});

describe('launcher messages', () => {
  it('formats elapsed times', () => {
    expect(elapsed(800)).toBe('0.8 s');
    expect(elapsed(12_340)).toBe('12.3 s');
    expect(elapsed(74_000)).toBe('1 min 14 s');
    expect(elapsed(125_000)).toBe('2 min 05 s');
  });

  it("follows Chrome for Testing's download and explains why it failed", () => {
    expect(parseDownloadProgress('|■■■■■■■■■■■■■■■■                                                                |  20% of 150.2 MiB\n|■■■■■■■■■■■■■■■■■■■■■■■■                                                        |  30% of 150.2 MiB')).toEqual({ fraction: 0.3, total: '150.2 MiB' });
    expect(parseDownloadProgress('Downloading Chromium 140')).toBeUndefined();
    expect(explainDownloadError('Error: getaddrinfo ENOTFOUND cdn.playwright.dev')).toMatch(/no internet/);
    expect(explainDownloadError('Download failed: server closed connection.')).toMatch(/no internet/);
    expect(explainDownloadError('ENOSPC: no space left on device')).toMatch(/disk is full/);
    expect(explainDownloadError('something else')).toBe("Couldn't download Chrome for Testing.");
  });
});

describe('the title scene', () => {
  const visible = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, '');

  it('never draws past the terminal edge, at any moment, wide or narrow', () => {
    for (const width of [10, 20, 40, 60, 80, 84, 86, 100, 120, 200])
      for (let t = 0; t <= INTRO_SECONDS; t += 0.2)
        for (const compact of [undefined, true]) for (const line of frame(t, width, { compact })) expect([...visible(line)].length).toBeLessThanOrEqual(width);
  });

  it('never cuts the tagline: the long one only where it fits', () => {
    for (const width of [40, 60, 80, 84, 86, 120]) {
      const tag = frame(INTRO_SECONDS, width, { color: false }).at(-1)?.trim() ?? '';
      expect(tag).toMatch(/^learn AWS by living in it( {2}· {2}every service is a place, every agent does its real job)?$/);
    }
    expect(frame(INTRO_SECONDS, 120, { color: false }).at(-1)).toContain('every agent does its real job');
  });

  it('spells AWS CITY in big letters, or small ones under 84 columns', () => {
    const big = frame(INTRO_SECONDS, 120, { color: false }).join('\n');
    expect(big).toContain('█████╗');
    expect(big).toContain('learn AWS by living in it');
    const small = frame(INTRO_SECONDS, 80, { color: false });
    expect(small[0]).toContain('▄▀█');
    expect(small.length).toBeLessThan(frame(INTRO_SECONDS, 120).length);
  });

  it('is the same picture for the same moment, and the traffic moves', () => {
    expect(frame(1.5, 120)).toEqual(frame(1.5, 120));
    const road = (t: number) => frame(t, 120, { color: false }).find((l) => l.includes('Bedrock'));
    expect(road(1.5)).toBeDefined();
    expect(road(1.5)).not.toEqual(road(1.6));
  });

  it('draws vehicles with a nose and a tail, not floating arrows', () => {
    for (const w of [80, 120]) for (const t of [0.5, 1.5, 2.6]) expect(frame(t, w, { color: false }).join('')).not.toMatch(/[▶◀]/);
    for (const kind of ['car', 'sports', 'truck', 'bus', 'van'] as const) {
      const [top, bottom] = vehicle(kind, ' EC2 ', '#ED7100', '#111111');
      expect(top.length).toBe(bottom.length);
      // facing right: the headlight (warm) is in the nose, the tail light (red) at the back
      expect(bottom.at(-1)).toMatchObject({ ch: '▐', fg: '#FFE38A' });
      expect(bottom[0]).toMatchObject({ ch: '▌', fg: '#FF4D4D' });
      expect(bottom.filter((c) => c?.ch === '●').length).toBeGreaterThanOrEqual(2);
      // mirrored for the left lane: lamps swap ends, the label still reads left to right
      const [ltop, lbottom] = vehicle(kind, ' EC2 ', '#ED7100', '#111111', false);
      expect(lbottom[0]).toMatchObject({ ch: '▌', fg: '#FFE38A' });
      expect(lbottom.at(-1)).toMatchObject({ ch: '▐', fg: '#FF4D4D' });
      expect(ltop.map((c) => c?.ch ?? '').join('')).toContain(' EC2 ');
      // not a saucer: the profile is not its own mirror image
      expect(top.map((c) => c?.ch ?? '.').join('')).not.toBe(ltop.map((c) => c?.ch ?? '.').join(''));
    }
  });

  it('plain mode has no colour codes', () => {
    expect(frame(INTRO_SECONDS, 120, { color: false }).join('')).not.toMatch(/\x1b/);
  });
});

describe('build progress', () => {
  it('turns WXT output into stages and a finish time', () => {
    const out = '\x1b[K⠋ [1/3] background\r⠴ [2/3] city, sidepanel\r⠇ [3/3] console\n✔ Built extension in 2.938 s\n';
    expect(parseBuildProgress(out)).toEqual([
      { step: 1, of: 3, label: 'background', name: 'wiring the power grid' },
      { step: 2, of: 3, label: 'city, sidepanel', name: 'laying the roads' },
      { step: 3, of: 3, label: 'console', name: 'building the bridge to the AWS console' },
      { done: true, seconds: 2.938 },
    ]);
    expect(parseBuildProgress('✔ Built extension in 850 ms')).toEqual([{ done: true, seconds: 0.85 }]);
    expect(parseBuildProgress('Σ Total size: 6.93 MB')).toEqual([]);
  });

  it('draws the bar', () => {
    expect(progressBar(0, 6)).toBe('▱▱▱▱▱▱');
    expect(progressBar(0.5, 6)).toBe('▰▰▰▱▱▱');
    expect(progressBar(1.4, 6)).toBe('▰▰▰▰▰▰');
  });
});

describe('the dashboard', () => {
  const visible = (l: string) => [...l.replace(/\x1b\[[0-9;]*m/g, '')].length;
  const state = (over: Partial<DashState> = {}): DashState => ({
    steps: [
      { id: 'a', title: 'Check AWS sign-in', status: 'done', detail: 'account 123456789012 (aws-city)', started: 0, ended: 800 },
      { id: 'b', title: 'Build the city', status: 'running', detail: 'laying the roads (2/3)', progress: 0.66, started: 1000 },
      { id: 'c', title: 'Start the server', status: 'pending' },
      { id: 'd', title: 'Open it', status: 'failed', detail: 'the browser did not start' },
    ],
    status: 'Building: laying the roads',
    keys: [['t', 'try again'], ['q', 'quit']],
    ...over,
  });

  it('fits any terminal from 80x24 to 200x60', () => {
    for (const [cols, rows] of [[80, 24], [100, 30], [120, 45], [200, 60]])
      for (const st of [state(), state({ info: ['Where: a new window', 'Side panel: pin it'], showLogs: true, logs: ['socket open'] })]) {
        const out = renderDashboard(st, 3, cols, rows, { now: 5000 });
        expect(out.length).toBeLessThanOrEqual(rows);
        for (const l of out) expect(visible(l)).toBeLessThanOrEqual(cols);
      }
  });

  it('says what every step is doing, with times, and keeps the keys on screen', () => {
    const out = renderDashboard(state(), 3, 120, 45, { color: false, now: 5000 }).join('\n');
    expect(out).toMatch(/✓ Check AWS sign-in\s+account 123456789012/);
    expect(out).toMatch(/[◐◓◑◒] Build the city\s+▰+▱+\s+laying the roads \(2\/3\)\s+4\.0 s/);
    expect(out).toContain('○ Start the server');
    expect(out).toContain('✗ Open it');
    expect(out).toContain('› Building: laying the roads');
    expect(out).toContain('[t] try again   [q] quit');
  });

  it('builds a crane for every unfinished step, and the full skyline once all are done', () => {
    const cranes = (st: DashState) => (renderDashboard(st, 3, 120, 45, { color: false }).join('').match(/┏/g) ?? []).length;
    expect(cranes(state())).toBe(3);
    expect(cranes(state({ steps: state().steps.map((s) => ({ ...s, status: 'done' as const })) }))).toBe(0);
  });

  it('wraps the "what next" lines and the keys instead of cutting them at 80 columns', () => {
    const info = ['Click once in the city to wake the sound (browsers keep a page quiet until you click). It is a long line.'];
    const keys: [string, string][] = [['c', 'city tab'], ['p', 'S3 practice page'], ['a', 'AWS console'], ['l', 'server log'], ['r', 'reopen'], ['q', 'quit']];
    const out = renderDashboard(state({ info, keys }), 3, 80, 40, { color: false, now: 5000 });
    const text = out.join('\n');
    expect(text).toContain('[q] quit');
    expect(text.replace(/[│\s]+/g, ' ')).toContain('until you click). It is a long line.');
    for (const l of out) expect(visible(l)).toBeLessThanOrEqual(80);
    expect(wrap('one two three four', 9)).toEqual(['one two', '  three', '  four']);
  });

  it('switches to the compact city when the terminal is short', () => {
    expect(renderDashboard(state(), 3, 120, 28, { color: false })[0]).toContain('▄▀█');
  });
});


describe('an AWS City window that is already open', async () => {
  const { lockPid, alreadyOpenPid, meaningfulLines, ALREADY_OPEN } = await import('../scripts/launcher/lib.mjs');

  it('reads the pid from Chrome’s SingletonLock target', () => {
    expect(lockPid('Salmans-MacBook-Air.local-74762')).toBe(74762);
    expect(lockPid('nonsense')).toBeUndefined();
    expect(lockPid(undefined)).toBeUndefined();
  });

  it('reads back the marker scripts/open.mjs prints', () => {
    expect(alreadyOpenPid(`AWS City is already open…\n${ALREADY_OPEN} 4242\n`)).toBe(4242);
    expect(alreadyOpenPid('READY abc')).toBeUndefined();
  });

  it('shows why a launch failed, not Playwright’s cleanup lines', () => {
    const out = [
      'browserType.launchPersistentContext: Target page, context or browser has been closed',
      'Browser logs:',
      'Opening in existing browser session.',
      '  - [pid=41462] starting temporary directories cleanup',
      '  - [pid=41462] finished temporary directories cleanup',
      '  - [pid=41462] <gracefully close end>',
      '  ]',
      '}',
      'Node.js v24.9.0',
    ].join('\n');
    const lines = meaningfulLines(out);
    expect(lines[0]).toMatch(/has been closed/);
    expect(lines.join(' ')).not.toMatch(/cleanup|gracefully|Node\.js/);
  });
});
