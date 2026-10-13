// Sound effects only (no music): Kenney CC0 samples for big moments, plus tiny synthesized voices for
// speech and UI so the city feels alive without being noisy. On by default at a soft volume; the
// toggle in the HUD persists in localStorage and follows other open surfaces through the storage event.
//
// Everything goes through one small mixer:
// - One AudioContext: Phaser's. Synth voices connect to `game.sound.destination`, so clips and voices
//   share the same mute and master volume, and there is one unlock.
// - Nothing is scheduled unless the context is running (before the first gesture, or while it's
//   suspended, a sound is dropped, never queued) and the document is visible.
// - Levels come from one table (LEVELS), measured from the clips' mean loudness, so a blip, a chime
//   and a fanfare sit together. Call sites name the sound; they don't pick the volume.
// - Priorities: big moments > feedback > blips > clicks. A lower sound is skipped for a moment after a
//   higher one, and a lower synth voice that just started is faded out when a higher sound arrives.
//   Each sound has its own throttle.
// - Sounds nobody's hand caused (backend events, agents chatting) play only on the surface that has
//   focus, or was focused last, when the side panel and the full tab are both open.
import type Phaser from 'phaser';
import type { Sfx } from './assets';

const KEY = 'aws-city.sfx';

/** 0 = clicks and steps, 1 = speech blips and ambience, 2 = feedback, 3 = big moments. */
type Pri = 0 | 1 | 2 | 3;
type Voice = 'click' | 'blip' | 'chime' | 'chimeDown';
type Name = Sfx | Voice;

/**
 * Per-sound gain, priority and throttle (ms). Clip gains bring each clip's mean loudness (ffmpeg
 * volumedetect on public/assets/kenney/audio) to a target: big moments ~-30 dB, feedback ~-33, steps
 * ~-44, ambient work ~-42. Synth gains are peak levels into the same mix.
 */
const LEVELS: Record<Name, { gain: number; pri: Pri; gap: number; hold?: number }> = {
  // `hold` (ms): the clip's own length. While it plays, quieter sounds wait (a fanfare isn't talked over).
  levelup: { gain: 0.16, pri: 3, gap: 800, hold: 1700 },
  discover: { gain: 0.155, pri: 3, gap: 600, hold: 600 },
  deploy: { gain: 0.19, pri: 3, gap: 800, hold: 440 },
  quest: { gain: 0.14, pri: 3, gap: 800, hold: 850 },
  door: { gain: 0.2, pri: 2, gap: 1500, hold: 900 }, // the city door and the HQ door 0.7 s later are one door
  correct: { gain: 0.12, pri: 2, gap: 150 },
  wrong: { gain: 0.11, pri: 2, gap: 200 },
  pop: { gain: 0.18, pri: 2, gap: 120 },
  whoosh: { gain: 0.1, pri: 2, gap: 200 },
  card: { gain: 0.32, pri: 2, gap: 120 }, // quiet on average (mean -37 dB) but its attack peaks at -8 dB: the loudest clip
  chime: { gain: 0.05, pri: 2, gap: 150 },
  chimeDown: { gain: 0.04, pri: 2, gap: 200 },
  work: { gain: 0.05, pri: 1, gap: 4000 },
  blip: { gain: 0.032, pri: 1, gap: 140 }, // per speaker
  step0: { gain: 0.07, pri: 0, gap: 90 },
  step1: { gain: 0.085, pri: 0, gap: 90 },
  step2: { gain: 0, pri: 0, gap: 90 }, // a 0.67 s scrape among 0.1 s taps: never played, see sfx()
  click: { gain: 0.025, pri: 0, gap: 60 },
};

/** ⋯ → Sound captions: words for the sounds that mean something (feedback and big moments, not steps or blips). */
export const CAPTIONS: Partial<Record<Name, string>> = {
  levelup: 'Level-up fanfare',
  discover: 'Discovery chime',
  deploy: 'Deploy whoosh',
  quest: 'Quest complete jingle',
  door: 'Door opens',
  correct: 'Right-answer ding',
  wrong: 'Wrong-answer buzz',
  pop: 'Pop',
  whoosh: 'Whoosh',
  card: 'Card flip',
  chime: 'Notification chime',
  chimeDown: 'Soft low chime',
};
const captionListeners = new Set<(text: string) => void>();
/** Hear about each captioned sound as it plays; returns the unsubscribe. */
export function onCaption(fn: (text: string) => void) {
  captionListeners.add(fn);
  return () => void captionListeners.delete(fn);
}

/** A lower-priority sound is skipped this long after a higher one starts (or for the higher clip's `hold`). */
const WINDOW = 220;
/** Speech blips across all speakers: at most one this often (a busy street murmurs, it doesn't chatter). */
const BLIP_GAP = 550;
/** Two feedback or big sounds this close together are one moment: the second is skipped. */
const SAME = { 2: 120, 3: 700 } as Partial<Record<Pri, number>>;
/** A sound counts as the player's own if it follows a press this soon. */
const GESTURE_MS = 1500;
/** Mini-game outcomes nobody pressed for (timers) play at this share of the level, throttled harder. */
const SOFT = 0.45;

type Manager = Phaser.Sound.WebAudioSoundManager;
let game: Phaser.Game | undefined;
let muted = read() === 'off';
const muteListeners = new Set<(m: boolean) => void>();
const last = new Map<string, number>();
const recent: { pri: Pri; at: number; hold: number; fade?: () => void }[] = [];
let lastGesture = -Infinity;
let blipAt = -Infinity;

const now = () => performance.now();

function read() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Phaser's Web Audio manager, only while it's alive (a destroyed game has no destination). */
function manager(): Manager | undefined {
  const sm = game?.sound as Manager | undefined;
  if (!sm || !('context' in sm) || !sm.context || !sm.destination || sm.context.state === 'closed') return undefined;
  return sm;
}

// ── surfaces: visibility, focus, which one leads when two are open ────────────────────────────────

const me = Math.random().toString(36).slice(2);
let leader: string | undefined;
let channel: BroadcastChannel | undefined;

function claim() {
  if (leader === me) return;
  leader = me;
  channel?.postMessage({ lead: me });
}
function release() {
  if (leader !== me) return;
  leader = undefined;
  channel?.postMessage({ lead: null });
}

/** Unlocks on the first press, keeps quiet while hidden, follows mute from other surfaces. */
function install() {
  if (typeof window === 'undefined') return;
  try {
    channel = new BroadcastChannel('aws-city.audio');
    channel.onmessage = (e: MessageEvent<{ lead?: string | null }>) => {
      if (e.data && 'lead' in e.data) leader = e.data.lead ?? undefined;
    };
  } catch {
    channel = undefined;
  }
  const gesture = () => {
    lastGesture = now();
    claim();
    const c = manager()?.context;
    if (c && c.state !== 'running' && !document.hidden) c.resume().catch(() => {});
  };
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, gesture, { capture: true, passive: true });
  window.addEventListener('focus', claim);
  document.addEventListener('visibilitychange', () => {
    const c = manager()?.context;
    if (document.hidden) {
      release();
      if (c?.state === 'running') c.suspend().catch(() => {});
    } else {
      if (document.hasFocus()) claim();
      if (c && c.state === 'suspended' && lastGesture > -Infinity) c.resume().catch(() => {});
    }
  });
  window.addEventListener('pagehide', release);
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    const m = (e.key === null ? read() : e.newValue) === 'off';
    if (m !== muted) apply(m);
  });
}
install();

/** True when this surface may make a sound now; `own` = it answers the player's press. */
function audible(own: boolean) {
  if (muted || document.hidden) return false;
  if (own || now() - lastGesture < GESTURE_MS) return true;
  return document.hasFocus() || leader === undefined || leader === me;
}

// ── mixer ─────────────────────────────────────────────────────────────────────────────────────────

/** Mixer verdict for `name` (throttle key `key`) at priority `pri`; records it when it may play. */
function admit(key: string, pri: Pri, gap: number, fade?: () => void, hold = 0) {
  const t = now();
  while (recent.length && t - recent[0].at > Math.max(800, recent[0].hold)) recent.shift();
  if ((last.get(key) ?? -Infinity) + gap > t) return false;
  for (const r of recent) {
    if (r.pri > pri && t - r.at < Math.max(WINDOW, r.hold)) return false;
    const same = SAME[pri];
    if (same && r.pri === pri && t - r.at < same) return false;
  }
  // A higher sound takes over: fade the lower voices that only just started.
  for (const r of recent) if (r.pri < pri && t - r.at < WINDOW) r.fade?.();
  last.set(key, t);
  const entry = { pri, at: t, hold, fade };
  recent.push(entry);
  return entry;
}

/** The context to schedule on, only when it can actually play now (else drop). */
function live(own: boolean) {
  if (!audible(own)) return undefined;
  const sm = manager();
  if (!sm || sm.context.state !== 'running') return undefined;
  return sm;
}

interface Note {
  freq: number;
  dur: number;
  type: OscillatorType;
  vol: number;
  slide?: number;
  delay?: number;
}

/** Schedules soft notes; returns a fader that ends them in ~25 ms. */
function play(sm: Manager, notes: Note[]) {
  const a = sm.context;
  const out = a.createGain();
  out.gain.value = 1;
  out.connect(sm.destination);
  let end = 0;
  for (const n of notes) {
    const t = a.currentTime + (n.delay ?? 0);
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = n.type;
    o.frequency.setValueAtTime(n.freq, t);
    if (n.slide) o.frequency.exponentialRampToValueAtTime(n.freq * n.slide, t + n.dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + n.dur + 0.03);
    end = Math.max(end, t + n.dur + 0.03);
    o.onended = () => o.disconnect();
  }
  setTimeout(() => out.disconnect(), (end - a.currentTime) * 1000 + 100);
  return () => {
    const t = a.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(0, t + 0.025);
  };
}

function voice(name: Voice, key: string, notes: (gain: number) => Note[], own: boolean) {
  const sm = live(own);
  if (!sm) return false;
  const lv = LEVELS[name];
  // Read by admit's callback before it's assigned, so it can't be const.
  // eslint-disable-next-line prefer-const
  let fader: (() => void) | undefined;
  if (!admit(key, lv.pri, lv.gap, () => fader?.())) return false;
  fader = play(sm, notes(lv.gain));
  caption(name);
  return true;
}

function caption(name: Name) {
  const text = CAPTIONS[name];
  if (text) for (const fn of captionListeners) fn(text);
}

// ── public API ────────────────────────────────────────────────────────────────────────────────────

/** Points the mixer at the current game. A second game (React StrictMode) simply replaces the first. */
export function attachAudio(g: Phaser.Game) {
  game = g;
  g.sound.mute = muted;
  // Phaser suspends audio on window blur; the side panel blurs whenever the player uses the page, and
  // the resume that follows is async, so the first press back would be silent. Visibility is handled above.
  g.sound.pauseOnBlur = false;
  g.events?.once?.('destroy', () => {
    if (game === g) game = undefined;
  });
}

/** Muting fades the master over ~20 ms first: an instant cut mid-sound clicks. */
const MUTE_FADE_MS = 25;

function apply(m: boolean) {
  muted = m;
  const sm = manager() as (Manager & { masterMuteNode?: GainNode }) | undefined;
  const node = sm?.masterMuteNode;
  if (m && node && sm.context.state === 'running') {
    const t = sm.context.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(node.gain.value, t);
    node.gain.linearRampToValueAtTime(0, t + MUTE_FADE_MS / 1000);
    const g = game;
    setTimeout(() => {
      if (muted && g?.sound) g.sound.mute = true;
    }, MUTE_FADE_MS + 5);
  } else if (game?.sound) {
    // A fade still on the timeline would hold the master at 0 after unmuting.
    node?.gain.cancelScheduledValues(0);
    game.sound.mute = m;
  }
  for (const fn of muteListeners) fn(m);
}

export function setMuted(m: boolean) {
  try {
    localStorage.setItem(KEY, m ? 'off' : 'on');
  } catch {
    /* storage blocked: the toggle still works for this page */
  }
  apply(m);
}

export const isMuted = () => muted;

/** Subscribe to mute changes (this surface or another one); returns the unsubscribe. */
export function onMuteChange(fn: (m: boolean) => void) {
  muteListeners.add(fn);
  return () => void muteListeners.delete(fn);
}

export interface SfxOpts {
  /** Caused by a timer, not the player's press: quieter and throttled harder. */
  soft?: boolean;
  /** Caused by the player (skips the focus check for sounds that come a little after the press). */
  own?: boolean;
}

/**
 * A Kenney sample (discover, level-up, deploy, door, footsteps…). The level comes from the mixer's
 * table; a numeric second argument (older call sites) is ignored.
 */
export function sfx(name: Sfx, opts?: number | SfxOpts) {
  const o = typeof opts === 'object' ? opts : {};
  if (name === 'click') return void click();
  if (name === 'step2') name = 'step0';
  const sm = live(!!o.own);
  if (!sm) return;
  const lv = LEVELS[name];
  const key = o.soft ? `${name}:soft` : name;
  if (!admit(key, lv.pri === 3 && o.soft ? 2 : lv.pri, o.soft ? Math.max(lv.gap, 400) : lv.gap, undefined, lv.hold)) return;
  try {
    sm.play(`sfx:${name}`, { volume: lv.gain * (o.soft ? SOFT : 1) });
    caption(name);
  } catch {
    /* not loaded yet */
  }
}

// Pentatonic (C major) from G4 to E6: any two speakers sound fine together.
const NOTES = [392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** A speaker's own note: the same every time, so each agent's voice is recognisable. */
export const blipNote = (speaker: string) => NOTES[hash(speaker) % NOTES.length];

/** A soft chat pop when someone speaks, in the speaker's own note; one at a time across the whole city. */
export function blip(speaker: string, soft = false) {
  const t = now();
  if (t - blipAt < BLIP_GAP) return;
  const n = blipNote(speaker);
  const ok = voice(
    'blip',
    `blip:${speaker}`,
    (gain) => {
      const v = gain * (soft ? 0.55 : 1);
      return [
        { freq: n, dur: 0.075, type: 'sine', vol: v, slide: 1.18 },
        { freq: n * 2, dur: 0.05, type: 'triangle', vol: v * 0.25, slide: 1.06, delay: 0.012 },
      ];
    },
    false,
  );
  if (ok) blipAt = t;
}

/** A soft, short UI tick. Throttled, and skipped when something more important just played. */
export function click() {
  voice('click', 'click', (gain) => [{ freq: 1400, dur: 0.028, type: 'sine', vol: gain, slide: 0.55 }], true);
}

/** Two gentle notes: up for good news (correct answer, XP), down for a miss. */
export function chime(up = true) {
  if (up) voice('chime', 'chime', (g) => [
    { freq: 659.25, dur: 0.14, type: 'sine', vol: g },
    { freq: 987.77, dur: 0.22, type: 'sine', vol: g, delay: 0.085 },
    { freq: 1975.5, dur: 0.12, type: 'triangle', vol: g * 0.12, delay: 0.085 },
  ], false);
  else voice('chimeDown', 'chimeDown', (g) => [
    { freq: 392, dur: 0.14, type: 'triangle', vol: g },
    { freq: 329.63, dur: 0.22, type: 'sine', vol: g, delay: 0.1 },
  ], false);
}
