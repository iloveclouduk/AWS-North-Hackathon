// "Lights out" (a practice drill the player starts): tapping a Zone island offers it; starting it turns that island's
// data halls dark for DRILL_MS under a 🔦 badge, and the concierge says once whether "your app" kept running
// (src/world/drill.ts decides). It is never a storm and never a red or amber fence: those mean real AWS status, and
// come only from the AWS Health feed. There's no drill on an island AWS reports trouble on, or while the whole
// Region has a storm, and a storm arriving ends one.
import Phaser from 'phaser';
import { drillOutcome, DRILL_MS, type DrillResult } from '@/world/drill';
import type { Placement } from '@/world/resources';
import { click } from './audio';
import { CITY_ISO, toScreen } from './iso';
import { keepTextInView, type Pt } from './labels';
import type { Landscape } from './Landscape';
import { reducedMotion } from './motion';
import type { RegionOverlay } from './RegionOverlay';
import { crisp, TEXT_FONT } from './SpeechBubble';
import { CSS, labelStyle, withAlpha } from './theme';

/** The offer stays up this long after the island is tapped. */
const OFFER_MS = 6_000;
/** The concierge speaks a beat after the lights go out. */
const SAY_AFTER_MS = 1_200;
const FLICKER_MS = 140;
const DEPTH = 40_120;

export interface DrillWorld {
  landscape: () => Landscape | undefined;
  region: () => RegionOverlay | undefined;
  placement: () => Placement | undefined;
  /** AWS Health has a storm on island i (or over the whole Region): no practice there now. */
  storm: (i: number) => boolean;
  /** The concierge's one bubble. */
  say: (r: DrillResult) => void;
  /** A short line when the drill can't start (a real storm there). */
  refuse: (text: string) => void;
}

export class LightsOut {
  private offerChip?: Phaser.GameObjects.Text;
  private offerIsland = -1;
  private offerTimer?: Phaser.Time.TimerEvent;
  private badge?: Phaser.GameObjects.Text;
  private badgeAnchor?: Pt;
  private timers: Phaser.Time.TimerEvent[] = [];
  private ui = 1;
  /** The island that's dark now, if a drill is running. */
  island?: number;

  constructor(
    private scene: Phaser.Scene,
    private world: DrillWorld,
  ) {}

  /** An island was tapped: offer the drill beside its label (or say why not, during a real storm there). */
  offer(i: number) {
    this.hideOffer();
    if (this.island !== undefined) return;
    const at = this.world.region()?.labelAt(i);
    if (!at) return;
    if (this.world.storm(i)) return;
    const letter = this.world.region()?.letter(i) ?? String.fromCharCode(65 + i);
    const chip = crisp(
      this.scene.add
        .text(at.x, Math.round(at.y + 20 * this.ui), `🔦 Try a lights-out drill in Zone ${letter} · 20 s`, { ...labelStyle(TEXT_FONT, CSS.accentInk), backgroundColor: CSS.accent, padding: { x: 6, y: 3 } })
        .setOrigin(0.5)
        .setDepth(DEPTH + 1)
        .setScale(this.ui),
    );
    chip.setInteractive({ useHandCursor: true });
    chip.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (Math.hypot(p.upX - p.downX, p.upY - p.downY) > 8) return;
      click();
      this.start(i);
    });
    this.offerChip = chip;
    this.offerIsland = i;
    this.offerTimer = this.scene.time.delayedCall(OFFER_MS, () => this.hideOffer());
  }

  start(i: number) {
    this.hideOffer();
    if (this.island !== undefined) return;
    if (this.world.storm(i)) return this.world.refuse('Not now: AWS reports real trouble there. Practice drills wait for calm skies.');
    this.island = i;
    const land = this.world.landscape();
    // A short flicker before the dark (none under reduced motion).
    if (reducedMotion()) land?.setIslandDark(i, true);
    else [0, 1, 2, 3, 4].forEach((k) => this.later(k * FLICKER_MS, () => land?.setIslandDark(i, k % 2 === 0)));
    const isl = this.world.region()?.azIslands[i];
    if (isl) {
      const c = toScreen(CITY_ISO, isl.rect.x + (isl.rect.w - 1) / 2, isl.rect.y + (isl.rect.h - 1) / 2);
      this.badge = crisp(
        this.scene.add
          .text(Math.round(c.x), Math.round(c.y - 34), '🔦 Lights out · practice', { ...labelStyle(TEXT_FONT, CSS.inkHi), backgroundColor: withAlpha('bg', 0.9) })
          .setOrigin(0.5)
          .setDepth(DEPTH)
          .setScale(this.ui),
      );
      this.badgeAnchor = { x: this.badge.x, y: this.badge.y };
    }
    const placement = this.world.placement();
    const letters = this.world.region()?.azIslands.map((_, n) => this.world.region()!.letter(n));
    const result = drillOutcome(placement ?? { zones: [] }, i, letters);
    this.later(SAY_AFTER_MS, () => this.world.say(result));
    this.later(DRILL_MS, () => this.end());
  }

  /** Lights back on (the drill's over, or a storm / a new Region cut it short). */
  end() {
    for (const t of this.timers) t.remove();
    this.timers = [];
    if (this.island !== undefined) this.world.landscape()?.setIslandDark(this.island, false);
    this.island = undefined;
    this.badge?.destroy();
    this.badge = undefined;
    this.hideOffer();
  }

  setUiScale(ui: number) {
    this.ui = ui;
    this.offerChip?.setScale(ui);
    this.badge?.setScale(ui);
  }

  keepInView(view: Phaser.Geom.Rectangle, inset: number) {
    // The offer hangs just under its island's label, wherever that label has been slid to stay in view.
    const label = this.world.region()?.labelOf(this.offerIsland);
    if (this.offerChip && label) {
      const a = { x: label.x, y: Math.round(label.y + (label.displayHeight + this.offerChip.displayHeight) / 2 + 2 * this.ui) };
      this.offerChip.setPosition(a.x, a.y);
      keepTextInView(this.offerChip, a, view, this.ui, inset);
    }
    if (this.badge && this.badgeAnchor) keepTextInView(this.badge, this.badgeAnchor, view, this.ui, inset);
  }

  destroy() {
    this.end();
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(this.scene.time.delayedCall(ms, fn));
  }

  private hideOffer() {
    this.offerTimer?.remove();
    this.offerTimer = undefined;
    this.offerChip?.destroy();
    this.offerChip = undefined;
    this.offerIsland = -1;
  }
}
