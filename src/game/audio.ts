// Sound: Kenney CC0 SFX + a tiny generated chiptune loop (WebAudio). Muted by default.
import type Phaser from 'phaser';
import type { Sfx } from './assets';

let game: Phaser.Game | undefined;
let muted = true;
let music: { ctx: AudioContext; stop: () => void } | undefined;

export function attachAudio(g: Phaser.Game) {
  game = g;
}

export function setMuted(m: boolean) {
  muted = m;
  if (game) game.sound.mute = m;
  if (m) {
    music?.stop();
    music = undefined;
  } else if (!music) music = startMusic();
}

export const isMuted = () => muted;

export function sfx(name: Sfx, volume = 0.5) {
  if (muted || !game) return;
  try {
    game.sound.play(`sfx:${name}`, { volume });
  } catch {
    /* not loaded yet */
  }
}

/** Four-bar chiptune loop: square-wave melody + triangle bass, ~100 bpm. */
function startMusic() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.05;
  master.connect(ctx.destination);
  const note = (freq: number, t: number, dur: number, type: OscillatorType, vol = 1) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
  const melody = [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 83, 79, 76, 74];
  const bass = [48, 48, 53, 53, 45, 45, 43, 43];
  const beat = 0.3;
  let bar = 0;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    const t0 = ctx.currentTime + 0.05;
    melody.forEach((n, i) => i % 2 === bar % 2 || note(hz(n), t0 + i * beat, beat * 0.9, 'square', 0.5));
    melody.forEach((n, i) => note(hz(n + (bar % 4 === 3 ? 2 : 0)), t0 + i * beat, beat * 0.8, 'square', 0.35));
    bass.forEach((n, i) => note(hz(n), t0 + i * beat * 2, beat * 1.8, 'triangle', 0.9));
    bar++;
    timer = setTimeout(schedule, melody.length * beat * 1000 - 60);
  };
  schedule();
  return {
    ctx,
    stop: () => {
      clearTimeout(timer);
      void ctx.close();
    },
  };
}
