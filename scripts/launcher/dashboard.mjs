// The `npm start` dashboard: the living city on top (cars, lights, a crane per unfinished step), a step checklist
// that says what's happening and how long it took, a status line, and the keys you can press. One screen, nothing
// scrolls away. `renderDashboard` is pure (unit-tested); `createDashboard` runs it.
import { COLORS as C, frame, paint } from './banner.mjs';
import { elapsed } from './lib.mjs';

const SPIN = ['◐', '◓', '◑', '◒'];
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex
const len = (s) => [...strip(s)].length;

/** Cuts plain text to `n` visible characters (with an ellipsis). */
const cut = (s, n) => ([...s].length <= n ? s : `${[...s].slice(0, Math.max(0, n - 1)).join('')}…`);

/** A boxed row: `│ content…padding │`, exactly `w` columns wide. `parts` are [text, colour?, bold?]. */
function boxRow(parts, w, color) {
  const inner = w - 4;
  let used = 0;
  let out = '';
  for (const [text, hex, bold] of parts) {
    if (used >= inner) break;
    const piece = cut(String(text), inner - used);
    used += [...piece].length;
    out += color && hex ? paint(piece, hex, { bold }) : piece;
  }
  const edge = color ? paint('│', C.kerb) : '│';
  return `${edge} ${out}${' '.repeat(Math.max(0, inner - used))} ${edge}`;
}

function boxEdge(kind, title, w, color) {
  const [l, r] = kind === 'top' ? ['╭', '╮'] : kind === 'mid' ? ['├', '┤'] : ['╰', '╯'];
  const label = title ? `─ ${title} ` : '';
  const line = `${l}${label}${'─'.repeat(Math.max(0, w - 2 - [...label].length))}${r}`;
  if (!color) return line;
  return title ? `${paint(l + '─ ', C.kerb)}${paint(title, C.orange, { bold: true })}${paint(` ${'─'.repeat(Math.max(0, w - 2 - [...label].length))}${r}`, C.kerb)}` : paint(line, C.kerb);
}

/** Word-wraps plain text to `n` columns (long words are cut), keeping blank lines. Continuation lines are indented. */
export function wrap(s, n) {
  if ([...s].length <= n) return [s];
  const out = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if ([...next].length <= n) line = next;
    else {
      if (line) out.push(line);
      line = `  ${cut(word, n - 2)}`;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Seconds each step usually takes, for steps that report no progress of their own (the city eases towards done). */
const EXPECTED = { aws: 2, bedrock: 4, prepare: 3, build: 15, server: 5, open: 3 };
/** What the city is doing while each step runs (the caption under the skyline). */
const DOING = { aws: 'checking your AWS keys', bedrock: 'wiring up the agents', prepare: 'laying the roads', build: 'raising the towers', server: 'switching on the power', open: 'opening the gates' };

/**
 * How built the city is, 0..1: finished steps (done, skipped or failed) count whole, a running step its own progress
 * if it reports one, else an ease on its elapsed time that never claims more than 90 % until it ends.
 */
export function stepsGrowth(steps, now = Date.now()) {
  if (!steps.length) return 1;
  let n = 0;
  for (const s of steps) {
    if (s.status === 'done' || s.status === 'skipped' || s.status === 'failed') n += 1;
    else if (s.status === 'running') {
      if (typeof s.progress === 'number') n += Math.max(0, Math.min(1, s.progress));
      else if (s.started) n += Math.min(0.9, 1 - Math.exp(-(now - s.started) / 1000 / (EXPECTED[s.id] ?? 5)));
    }
  }
  return Math.max(0, Math.min(1, n / steps.length));
}

/** "City 63% built · raising the towers" (or "City built" when everything is done). */
export function growthCaption(steps, now = Date.now()) {
  const g = stepsGrowth(steps, now);
  const running = steps.find((s) => s.status === 'running');
  if (g >= 1 && !running) return 'City built ✶';
  return `City ${Math.floor(g * 100)}% built${running ? ` · ${DOING[running.id] ?? 'building'}` : ''}`;
}

/**
 * One screen of the dashboard.
 * state: { steps: [{ id, title, status: 'pending'|'running'|'done'|'failed'|'skipped', detail?, started?, ended?, progress? }],
 *          status?, info?: string[], infoTitle?, logs?: string[], showLogs?, logTitle?, keys?: [key, label][] }
 * Returns exactly `rows` lines or fewer, none wider than `cols`.
 */
export function renderDashboard(state, t, cols, rows, { color = true, now = Date.now() } = {}) {
  const w = Math.max(40, Math.min(cols, 110) - 1);
  const pending = state.steps.filter((s) => s.status !== 'done' && s.status !== 'skipped').length;
  // Info lines wrap rather than cut: "what to do next" must be readable at 80 columns.
  const info = (state.info ?? []).flatMap((l) => wrap(l, w - 4));
  // The keys wrap onto a second line rather than lose "[q] quit" off the edge of a narrow terminal.
  const keyRows = [];
  for (const [k, label] of state.keys ?? []) {
    const piece = [`[${k}] ${label}`, color ? `${paint(`[${k}]`, C.amber, { bold: true })} ${label}` : `[${k}] ${label}`];
    const last = keyRows.at(-1);
    if (last && [...last.plain].length + 3 + [...piece[0]].length <= w) {
      last.plain += `   ${piece[0]}`;
      last.text += `   ${piece[1]}`;
    } else keyRows.push({ plain: piece[0], text: piece[1] });
  }
  const below = state.steps.length + 3 + (info.length ? info.length + 2 : 0) + (state.showLogs ? 8 : 0) + 1 + keyRows.length;
  const compact = cols < 84 || rows - below < 21;
  // The skyline grows with the run (stepsGrowth): lots fill in, floors rise and lights come on as the steps finish.
  let city = frame(t, cols, { color, compact, pending, tagline: false, growth: stepsGrowth(state.steps, now) });
  const caption = growthCaption(state.steps, now);
  city.push(color ? paint(caption.slice(0, w), C.dim) : caption.slice(0, w));
  // Never let the city push the steps off screen: trim sky rows from the top if it's really tight.
  const room = Math.max(0, rows - below);
  if (city.length > room) city = city.slice(city.length - room);

  const lines = [...city, boxEdge('top', 'Steps', w, color)];
  for (const s of state.steps) {
    const icon = { done: ['✓', '#4ADE80'], failed: ['✗', C.beacon], skipped: ['–', C.dim], running: [SPIN[Math.floor(t * 8) % 4], C.amber], pending: ['○', C.dim] }[s.status];
    const time = s.started ? elapsed((s.ended ?? now) - s.started) : '';
    const bar = s.status === 'running' && s.progress !== undefined ? `${'▰'.repeat(Math.round(s.progress * 10))}${'▱'.repeat(10 - Math.round(s.progress * 10))}  ` : '';
    const title = s.title.padEnd(26);
    const detail = s.detail ?? '';
    const room = w - 4 - 2 - [...title].length - [...bar].length - time.length - 2;
    lines.push(
      boxRow(
        [
          [`${icon[0]} `, icon[1], true],
          [title, s.status === 'pending' ? C.dim : C.text, s.status === 'running'],
          [bar, C.orange],
          [cut(detail, Math.max(0, room)).padEnd(Math.max(0, room)), s.status === 'failed' ? C.beacon : C.dim],
          [`  ${time}`, C.dim],
        ],
        w,
        color,
      ),
    );
  }
  if (state.showLogs) {
    lines.push(boxEdge('mid', state.logTitle ?? 'Server log', w, color));
    const logs = (state.logs ?? []).slice(-6);
    for (let i = 0; i < 6; i++) lines.push(boxRow([[logs[i] ?? '', C.dim]], w, color));
  }
  if (info.length) {
    lines.push(boxEdge('mid', state.infoTitle ?? "You're in!", w, color));
    for (const l of info) lines.push(boxRow([[l, C.text]], w, color));
  }
  lines.push(boxEdge('bottom', '', w, color));
  if (state.status) lines.push(color ? ` ${paint('›', C.orange, { bold: true })} ${cut(state.status, w - 4)}` : ` › ${cut(state.status, w - 4)}`);
  for (const row of keyRows) lines.push(` ${row.text}`);
  return lines.slice(0, rows).map((l) => (len(l) > cols ? cut(strip(l), cols) : l));
}

// Interactive needs a terminal on both ends; NO_COLOR only turns the colours off (the keys still work).
const isTTY = () => Boolean(process.stdout.isTTY && process.stdin.isTTY && !process.env.CI);

/**
 * Runs the dashboard in the alternate screen at ~15 fps. Without a terminal it prints one line per change instead.
 * Returns controls: set(id, patch), status(text), log(line), info(lines, title), waitKey(items), close(summary).
 * Ctrl-C leaves the alternate screen, prints `onInterrupt()`'s lines and exits (130); the exit handlers stop the
 * children (scripts/launcher/cleanup.mjs).
 */
export function createDashboard(steps, { onInterrupt = () => [] } = {}) {
  const state = { steps: steps.map((s) => ({ status: 'pending', ...s })), logs: [] };
  const live = isTTY();
  const color = !process.env.NO_COLOR;
  const started = Date.now();
  let timer;
  let onKey;
  let open = live;

  const draw = () => {
    if (!open) return;
    const out = renderDashboard(state, (Date.now() - started) / 1000, process.stdout.columns ?? 100, process.stdout.rows ?? 40, { color });
    process.stdout.write(`\x1b[H${out.map((l) => `${l}\x1b[K`).join('\n')}\x1b[J`);
  };
  const onData = (buf) => {
    const k = buf.toString().toLowerCase();
    if (k.includes('\u0003')) {
      restore();
      const lines = onInterrupt();
      if (lines.length) console.log(`\n${lines.join('\n')}\n`);
      process.exit(130);
    }
    onKey?.(k);
  };
  // Leaves the alternate screen exactly once: a second "leave" would jump the cursor back above the summary.
  const restore = () => {
    if (!open) return;
    open = false;
    clearInterval(timer);
    process.stdout.off('resize', draw);
    process.stdin.off('data', onData);
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\x1b[?25h\x1b[?1049l');
    } catch {
      // the terminal closed
    }
  };

  if (live) {
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    timer = setInterval(draw, 66);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
    process.once('exit', restore);
    process.stdout.on('resize', draw);
  }

  const plain = (msg) => !live && console.log(msg);
  return {
    state,
    set(id, patch) {
      const s = state.steps.find((x) => x.id === id);
      if (!s) return;
      if (patch.status === 'running' && s.status !== 'running') {
        s.started = Date.now();
        s.ended = undefined;
        s.progress = undefined;
      }
      if ((patch.status === 'done' || patch.status === 'failed' || patch.status === 'skipped') && !s.ended) s.ended = Date.now();
      Object.assign(s, patch);
      if (patch.status) plain(`${{ done: '✓', failed: '✗', running: '…', skipped: '–', pending: '○' }[patch.status]} ${s.title}${s.detail ? ` — ${s.detail}` : ''}`);
    },
    status(text) {
      state.status = text;
    },
    log(line) {
      state.logs.push(line);
      if (state.logs.length > 200) state.logs.shift();
    },
    toggleLogs(show = !state.showLogs) {
      state.showLogs = show;
    },
    logTitle(title) {
      state.logTitle = title;
    },
    clearLogs() {
      state.logs = [];
    },
    info(lines, title) {
      state.info = lines;
      state.infoTitle = title;
      if (lines?.length) plain(`\n${title ?? "You're in!"}\n${lines.map((l) => `  ${l}`).join('\n')}`);
    },
    /** Waits for one of the item keys; without a terminal it returns 'q' (scripts never hang). */
    waitKey(items) {
      state.keys = items;
      if (!live) return Promise.resolve('q');
      const keys = new Set(items.map(([k]) => k));
      return new Promise((resolve) => {
        onKey = (k) => {
          if (!keys.has(k)) return;
          onKey = undefined;
          resolve(k);
        };
      });
    },
    close(summary = []) {
      restore();
      if (summary.length) console.log(`\n${summary.join('\n')}\n`);
    },
  };
}
