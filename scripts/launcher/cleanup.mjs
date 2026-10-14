// Whatever way `npm start` ends (q, Ctrl-C, a crash, the terminal closing), nothing is left behind: the processes
// it started (browser, build, server) are stopped, and the terminal gets its cursor and normal input mode back.
const running = new Map();

/** Remembers a child process so it's stopped when the launcher exits. `kill` overrides how (e.g. a process group). */
export function track(child, kill = () => child.kill()) {
  running.set(child, kill);
  child.once('exit', () => running.delete(child));
  return child;
}

export function stopChildren() {
  for (const kill of running.values()) {
    try {
      kill();
    } catch {
      // already gone
    }
  }
  running.clear();
}

/** Raw mode off, cursor visible. Safe to call any number of times, even after the terminal has gone. */
export function restoreTerminal() {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    if (process.stdout.isTTY) process.stdout.write('\x1b[?25h');
  } catch {
    // the terminal closed
  }
}

let installed = false;
/** Once per process: stop children and restore the terminal on exit, and turn signals into a normal exit. */
export function installCleanup() {
  if (installed) return;
  installed = true;
  process.on('exit', () => {
    stopChildren();
    restoreTerminal();
  });
  // Without a handler Node dies on these signals without running 'exit' handlers.
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(signal, () => process.exit(code));
}
