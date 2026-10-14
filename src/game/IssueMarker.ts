import Phaser from 'phaser';
import type { CityFinding } from '@/backend/contract';
import { landmarkLayout } from '@/world/layout';
import { toScreen, type Iso } from './iso';
import { reducedMotion } from './motion';
import { crisp, TEXT_FONT } from './SpeechBubble';
import { COLOR, CSS, FONT_SIZE } from './theme';

/** Severity colours (the UI's --bad / --accent / --warn tokens). */
export const SEVERITY_COLOR: Record<CityFinding['severity'], number> = { high: COLOR.bad, medium: COLOR.accent, low: COLOR.warn };
const RANK = { low: 0, medium: 1, high: 2 } as const;

/** The worst severity among a landmark's open findings. */
export const worstSeverity = (fs: Pick<CityFinding, 'severity'>[]) =>
  fs.reduce<CityFinding['severity']>((w, f) => (RANK[f.severity] > RANK[w] ? f.severity : w), 'low');

/**
 * An issue marker over one landmark: a traffic cone in the severity's colour (smoking when high) and a small
 * crisp "!" tag with the count when there's more than one. Clicking it opens the finding. Every cone always shows;
 * the tag shows on the most urgent landmark, or when the player looks closer (IssueMarkers.setTagsShown).
 */
class IssueMarker {
  private cone: Phaser.GameObjects.Graphics;
  private tag: Phaser.GameObjects.Text;
  private bounce?: Phaser.Tweens.Tween;
  /** For ordering: worst severity, then how many. */
  rank = 0;
  private smoke?: Phaser.Time.TimerEvent;
  private puffs: Phaser.GameObjects.Arc[] = [];
  private nextPuff = 0;
  private x: number;
  private y: number;

  constructor(
    private scene: Phaser.Scene,
    iso: Iso,
    readonly serviceId: string,
    onClick: (serviceId: string) => void,
  ) {
    const f = landmarkLayout(serviceId)!.footprint;
    // The front corner tile of the footprint, so the cone stands at the street side of the building.
    const c = toScreen(iso, f.x + f.w - 1, f.y + f.h - 1);
    this.x = Math.round(c.x + iso.halfW * 0.6);
    this.y = Math.round(c.y + 2);
    this.cone = scene.add.graphics().setDepth(45_000);
    this.tag = crisp(
      scene.add.text(this.x, this.y - 22, '', { fontFamily: TEXT_FONT, fontSize: FONT_SIZE.md, fontStyle: '900', color: CSS.accentInk, padding: { x: 5, y: 1 } }).setOrigin(0.5, 1).setDepth(45_001),
    );
    this.tag.setInteractive({ useHandCursor: true });
    this.tag.on('pointerup', (p: Phaser.Input.Pointer) => p.getDistance() < 8 && onClick(serviceId));
  }

  /** Show the tag; only the lead marker bounces (one moving thing draws the eye, six are noise). */
  showTag(on: boolean, lead: boolean) {
    this.tag.setVisible(on);
    const bounce = on && lead && !reducedMotion();
    if (bounce && !this.bounce) this.bounce = this.scene.tweens.add({ targets: this.tag, y: this.y - 26, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
    if (!bounce && this.bounce) {
      this.bounce.remove();
      this.bounce = undefined;
      this.tag.setY(this.y - 22);
    }
  }

  set(findings: CityFinding[]) {
    const sev = worstSeverity(findings);
    const color = SEVERITY_COLOR[sev];
    const g = this.cone.clear();
    const { x, y } = this;
    // A 9×12 pixel cone: base, body, white stripe.
    g.fillStyle(COLOR.bg, 0.35).fillEllipse(x, y, 14, 4);
    g.fillStyle(color, 1).fillRect(x - 6, y - 2, 12, 2);
    g.fillTriangle(x - 4, y - 2, x + 4, y - 2, x, y - 13);
    g.fillStyle(0xffffff, 1).fillRect(x - 2, y - 8, 4, 2);
    // Not by colour alone: a high-severity issue says "!!" (it also smokes, unless motion is reduced).
    const mark = sev === 'high' ? '!!' : '!';
    this.tag.setText(findings.length > 1 ? `${mark} ${findings.length}` : mark).setBackgroundColor(`#${color.toString(16).padStart(6, '0')}`);
    this.rank = RANK[sev] * 100 + findings.length;
    this.smoke?.remove();
    this.smoke = undefined;
    if (sev === 'high' && !reducedMotion()) this.smoke = this.scene.time.addEvent({ delay: 650, loop: true, callback: () => this.puff() });
  }

  /** A puff of smoke from a high-severity cone: three circles reused in turn (a puff lives 1.4 s, one starts every 0.65 s). */
  private puff() {
    if (typeof document !== 'undefined' && document.hidden) return;
    const k = this.nextPuff++ % PUFFS;
    const p = (this.puffs[k] ??= this.scene.add.circle(0, 0, 2, 0x9ca3af, 0.7).setDepth(44_999));
    this.scene.tweens.killTweensOf(p);
    p.setPosition(this.x + Phaser.Math.Between(-2, 2), this.y - 13).setAlpha(0.7).setScale(1).setVisible(true);
    this.scene.tweens.add({ targets: p, y: this.y - 30, alpha: 0, scale: 2.2, duration: 1400, ease: 'Sine.easeOut' });
  }

  setUiScale(s: number) {
    this.tag.setScale(s);
  }

  destroy() {
    this.smoke?.remove();
    for (const p of this.puffs) (this.scene.tweens.killTweensOf(p), p.destroy());
    this.puffs = [];
    this.bounce?.remove();
    this.cone.destroy();
    this.tag.destroy();
  }
}

/** One marker per landmark with open findings, kept in step with the store. */
/** Smoke circles per high-severity marker, reused in turn. */
const PUFFS = 3;

export class IssueMarkers {
  private markers = new Map<string, IssueMarker>();
  private ui = 1;
  private all = false;
  private wanted: (serviceId: string) => boolean = () => false;

  constructor(
    private scene: Phaser.Scene,
    private iso: Iso,
    private onClick: (serviceId: string) => void,
  ) {}

  has(serviceId: string) {
    return this.markers.has(serviceId);
  }

  sync(open: CityFinding[]) {
    const by = new Map<string, CityFinding[]>();
    for (const f of open) if (landmarkLayout(f.serviceId)) by.set(f.serviceId, [...(by.get(f.serviceId) ?? []), f]);
    for (const [id, m] of this.markers) if (!by.has(id)) m.destroy(), this.markers.delete(id);
    for (const [id, fs] of by) {
      let m = this.markers.get(id);
      if (!m) {
        m = new IssueMarker(this.scene, this.iso, id, this.onClick);
        m.setUiScale(this.ui);
        this.markers.set(id, m);
      }
      m.set(fs);
    }
    this.syncTags();
  }

  /**
   * Which "!" tags show: all of them when zoomed in (`all`), else the most urgent landmark's and any the player is
   * looking at (`wanted`: selected, focused or hovered). The cones always show, so no issue is ever hidden.
   */
  setTagsShown(all: boolean, wanted: (serviceId: string) => boolean) {
    this.all = all;
    this.wanted = wanted;
    this.syncTags();
  }

  private syncTags() {
    let lead: IssueMarker | undefined;
    for (const m of this.markers.values()) if (!lead || m.rank > lead.rank) lead = m;
    for (const [id, m] of this.markers) m.showTag(this.all || m === lead || this.wanted(id), m === lead);
  }

  setUiScale(s: number) {
    this.ui = s;
    for (const m of this.markers.values()) m.setUiScale(s);
  }
}
