// Sound effects only (no music): Kenney CC0 samples for big moments, plus tiny synthesized blips for
// speech and UI so the city feels alive without being noisy. On by default at a soft volume; the
// toggle in the HUD persists in localStorage.
import type Phaser from 'phaser';
import type { Sfx } from './assets';

const KEY = 'aws-city.sfx';
const MASTER = 0.35;

let game: Phaser.Game | undefined;
let muted = localStorage.getItem(KEY) === 'off';
let ctx: AudioContext | undefined;
let lastBlip = 0;

export function attachAudio(g: Phaser.Game) {
  game = g;
  g.sound.mute = muted;
}

export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem(KEY, m ? 'off' : 'on');
  if (game) game.sound.mute = m;
}

export const isMuted = () => muted;

/** A Kenney sample (discover, level-up, deploy, door, footsteps…) at a gentle volume. */
export function sfx(name: Sfx, volume = 0.5) {
  if (muted || !game) return;
  try {
    game.sound.play(`sfx:${name}`, { volume: volume * MASTER });
  } catch {
    /* not loaded yet */
  }
}

function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
  const a = audio();
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * MASTER, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Habbo-style chat pop when someone speaks; each speaker has their own pitch. Throttled. */
export function blip(speaker: string, soft = false) {
  if (muted) return;
  const now = performance.now();
  if (now - lastBlip < 90) return;
  lastBlip = now;
  const base = 520 + (hash(speaker) % 7) * 60;
  tone(base, 0.07, 'triangle', soft ? 0.12 : 0.25, 1.35);
  tone(base * 1.5, 0.05, 'sine', soft ? 0.06 : 0.12, 1.1, 0.04);
}

/** Soft UI click. */
export function click() {
  if (muted) return;
  tone(880, 0.035, 'square', 0.08, 0.7);
}

/** Two-note chime for good news (correct answer, XP). */
export function chime(up = true) {
  if (muted) return;
  const [a, b] = up ? [660, 990] : [440, 330];
  tone(a, 0.12, 'sine', 0.22);
  tone(b, 0.18, 'sine', 0.22, 1, 0.09);
}
