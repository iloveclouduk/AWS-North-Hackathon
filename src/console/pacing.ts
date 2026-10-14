// How fast the Copilot acts, and the player's Pause. DOM-free (tested in tests/console-cloudscape.test.ts).

export const SPEEDS = { slow: 2500, normal: 1400, fast: 700 } as const;
export type Speed = keyof typeof SPEEDS;
export const DEFAULT_SPEED: Speed = 'normal';
/** chrome.storage.local key (the content script reads it; the chip's toggle writes it). */
export const SPEED_KEY = 'copilotSpeed';
export const SPEED_LABEL: Record<Speed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };

export const parseSpeed = (v: unknown): Speed => (typeof v === 'string' && v in SPEEDS ? (v as Speed) : DEFAULT_SPEED);
export const nextSpeed = (s: Speed): Speed => (s === 'slow' ? 'normal' : s === 'normal' ? 'fast' : 'slow');

/**
 * Gates every action: the read time for the current speed, plus any "Explain again" extension, and
 * nothing happens while paused. `hold` resolves false as soon as the Copilot is stopped.
 */
export class Pacer {
  speed: Speed = DEFAULT_SPEED;
  paused = false;
  stopped = false;
  private extra = 0;
  private wakers = new Set<() => void>();

  get readMs() {
    return SPEEDS[this.speed];
  }

  /** "Explain again": give the player more time on the current bubble. */
  extend(ms: number) {
    this.extra += ms;
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.wake();
  }

  stop() {
    this.stopped = true;
    this.wake();
  }

  private wake() {
    for (const w of this.wakers) w();
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.wakers.delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      this.wakers.add(done);
    });
  }

  /** Wait `ms` (+ extensions), then block while paused. False = stopped, don't act. */
  async hold(ms: number = this.readMs): Promise<boolean> {
    this.extra = 0;
    let end = Date.now() + ms;
    for (;;) {
      if (this.stopped) return false;
      if (this.extra) {
        end += this.extra;
        this.extra = 0;
      }
      const left = end - Date.now();
      if (left <= 0 && !this.paused) return true;
      await this.sleep(this.paused ? 250 : Math.min(left, 250));
    }
  }
}
