import Phaser from 'phaser';
import type { Tile } from '@/world/layout';
import { foundIn, GLINT_TILES, tokenFact, tokensFor, TOKENS_PER_CITY, type Token } from '@/world/tokens';
import { useCity } from '@/state/store';
import { addSprite, hasSprite } from './assets';
import { CITY_ISO, footprintDepth, toScreen } from './iso';
import { reducedMotion } from './motion';

const SPIN_MS = 140;

/**
 * The city's golden tokens (src/world/tokens.ts): hidden until Kai walks within GLINT_TILES, then they glint and spin;
 * stepping on one collects it (Progress.finds, synced). `onFound` lets the scene celebrate (one moment, on the street).
 */
export class Tokens {
  private shown: { token: Token; img: Phaser.GameObjects.Image }[] = [];
  private key = '';
  private frame = 0;
  private frameAt = 0;

  constructor(
    private scene: Phaser.Scene,
    private streets: () => Tile[],
    private onFound: (token: Token, fact: string, found: number, of: number) => void,
  ) {}

  /** Lays out the city's unfound tokens (again when the Region or the streets change). */
  sync() {
    const st = useCity.getState();
    const all = tokensFor(st.cityRegion, this.streets());
    const left = all.filter((t) => !st.progress.finds?.[t.id]);
    const key = `${st.cityRegion}|${left.map((t) => `${t.id}@${t.x},${t.y}`).join(';')}`;
    if (key === this.key || !hasSprite('token:0')) return;
    this.key = key;
    this.clear();
    for (const token of left) {
      const p = toScreen(CITY_ISO, token.x, token.y);
      const img = addSprite(this.scene, 'token:0', p.x, p.y).setDepth(footprintDepth(CITY_ISO, { x: token.x, y: token.y, w: 1, h: 1 }) + 1).setAlpha(0);
      this.shown.push({ token, img });
    }
  }

  /** Per frame: glint near Kai, spin, and pick up the one he stands on. */
  update(time: number, kai: Tile) {
    const spin = !reducedMotion() && time - this.frameAt >= SPIN_MS;
    if (spin) {
      this.frameAt = time;
      this.frame = (this.frame + 1) % 4;
    }
    for (const s of [...this.shown]) {
      const d = Math.abs(s.token.x - kai.x) + Math.abs(s.token.y - kai.y);
      if (d === 0) {
        this.collect(s);
        continue;
      }
      const target = d <= GLINT_TILES ? 1 - (d - 1) / (GLINT_TILES + 1) : 0;
      s.img.setAlpha(s.img.alpha + (target - s.img.alpha) * 0.15);
      if (spin && s.img.alpha > 0.05) s.img.setFrame(`token:${this.frame}`);
    }
  }

  private collect(s: { token: Token; img: Phaser.GameObjects.Image }) {
    this.shown = this.shown.filter((x) => x !== s);
    s.img.destroy();
    if (!useCity.getState().collectFind(s.token.id)) return;
    const st = useCity.getState();
    this.onFound(s.token, tokenFact(s.token.certId), foundIn(st.progress, st.cityRegion), TOKENS_PER_CITY);
  }

  private clear() {
    for (const s of this.shown) s.img.destroy();
    this.shown = [];
  }

  destroy() {
    this.clear();
    this.key = '';
  }
}
