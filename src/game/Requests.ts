import Phaser from 'phaser';
import { bus } from '@/state/bus';
import { countRequest, pickRequest, REQUEST_GAP_MS, requestsLeft, type RequestLog } from '@/state/requests';
import { dayKey } from '@/state/progress';
import { useCity } from '@/state/store';
import type { Agent } from './Agent';
import { click } from './audio';
import { reducedMotion } from './motion';
import { crisp, TEXT_FONT } from './SpeechBubble';
import { CSS, labelStyle } from './theme';

const LOG_KEY = 'awscity.requests';
const readLog = (): RequestLog | undefined => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(LOG_KEY) ?? 'null') as RequestLog | null;
    return v && typeof v.day === 'string' && typeof v.n === 'number' ? v : undefined;
  } catch {
    return undefined;
  }
};
const writeLog = (log: RequestLog) => {
  try {
    globalThis.localStorage?.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable */
  }
};

/**
 * One citizen at a time has a question (src/state/requests.ts): a gold "?" over an existing pedestrian (no new walkers,
 * so the crowd cap holds). Tapping the "?" walks Kai over; reaching them (by any route) opens the question card.
 */
export class Requests {
  private asker?: Agent;
  private mark?: Phaser.GameObjects.Text;
  private bob?: Phaser.Tweens.Tween;
  private nextAt: number;

  constructor(
    private scene: Phaser.Scene,
    private citizens: () => Agent[],
    private player: () => Agent,
  ) {
    // The first one comes a little while after arriving, not on the doorstep.
    this.nextAt = scene.time.now + REQUEST_GAP_MS / 3;
  }

  update(time: number, ui: number) {
    if (!this.asker) {
      if (time >= this.nextAt) this.spawn(time);
      return;
    }
    if (!this.citizens().includes(this.asker)) return this.clear(time); // the crowd thinned (panel width)
    const s = this.asker.screen;
    this.mark?.setPosition(Math.round(s.x), Math.round(s.y - 58 * ui)).setScale(ui);
    const p = this.player();
    if (Math.abs(p.gx - this.asker.gx) + Math.abs(p.gy - this.asker.gy) <= 1) this.open(time);
  }

  private spawn(time: number) {
    this.nextAt = time + REQUEST_GAP_MS;
    const today = dayKey();
    if (requestsLeft(readLog(), today) <= 0) return;
    const st = useCity.getState();
    if (st.view.name !== 'city') return;
    const idle = this.citizens().filter((c) => !c.isBusy);
    const who = idle[Math.floor(Math.random() * idle.length)];
    if (!who || !pickRequest(st.progress, st.cityRegion, 0)) return;
    this.asker = who;
    who.pin(true);
    this.mark = crisp(this.scene.add.text(0, 0, '?', { ...labelStyle(TEXT_FONT, CSS.accentInk), fontSize: '15px', fontStyle: '900', backgroundColor: CSS.gold, padding: { x: 6, y: 2 } }))
      .setOrigin(0.5, 1)
      .setDepth(50_500)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', (ptr: Phaser.Input.Pointer) => {
        if (ptr.getDistance() >= 8 || !this.asker) return;
        click();
        this.player().goTo(this.asker.tile);
      });
    if (!reducedMotion()) this.bob = this.scene.tweens.add({ targets: this.mark, scaleY: { from: 1, to: 1.12 }, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut' });
  }

  private open(time: number) {
    const who = this.asker!;
    const st = useCity.getState();
    const request = pickRequest(st.progress, st.cityRegion, Math.floor(Math.random() * 1e6));
    who.face(this.player().tile);
    who.emote('wave', 1200);
    writeLog(countRequest(readLog(), dayKey()));
    this.clear(time);
    if (request) bus.emit('citizenRequest', { request, name: who.name.split(' · ')[0] ?? 'A citizen' });
  }

  private clear(time: number) {
    this.asker?.pin(false);
    this.asker = undefined;
    this.bob?.remove();
    this.bob = undefined;
    this.mark?.destroy();
    this.mark = undefined;
    this.nextAt = Math.max(this.nextAt, time + REQUEST_GAP_MS);
  }

  destroy() {
    this.clear(0);
  }
}
