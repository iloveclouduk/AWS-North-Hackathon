// The game's colours and text sizes: the UI's tokens (src/app/styles/00-base.css) mirrored for Phaser, so the canvas
// and the panels read as one warm-graphite-and-amber look. New canvas text and colours come from here.
import type Phaser from 'phaser';

/** CSS colours (Phaser text styles take strings). Same names as the CSS custom properties. */
export const CSS = {
  bg: '#15171b',
  bgDeep: '#0f1114',
  panel: '#1e2126',
  panelHi: '#2c3138',
  line: '#2c3038',
  ink: '#e6e2d8',
  inkHi: '#fff8ee',
  inkSoft: '#c9c4b8',
  muted: '#8b8f98',
  accent: '#f0a63a',
  accentInk: '#2a1a04',
  good: '#5db39e',
  goodInk: '#bfe8dc',
  warn: '#e8c15a',
  bad: '#e5676b',
  badInk: '#f6c9ca',
  info: '#8fb8e8',
  infoInk: '#d6e4f5',
  highlight: '#f6e7c1',
  quote: '#f3dfb5',
  quoteInk: '#1f1608',
  gold: '#ffc233',
  goldHi: '#fff1b8',
  paperInk: '#1b1200',
  paperMeta: '#92400e',
  bubble: '#ffffff',
  bubbleInk: '#111111',
  roleOk: '#047857',
} as const;

export type ThemeColor = keyof typeof CSS;

/** `#rrggbb` → 0xrrggbb, for Graphics fills and tints. */
export const hex = (css: string) => parseInt(css.replace('#', '').slice(0, 6), 16);

/** The same tokens as numbers. */
export const COLOR = Object.fromEntries(Object.entries(CSS).map(([k, v]) => [k, hex(v)])) as Record<ThemeColor, number>;

/** A token with an alpha byte, for text backgrounds (`'#15171bd9'`). */
export const withAlpha = (c: ThemeColor, alpha: number) => `${CSS[c]}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`;

/** Text sizes on the canvas: small labels, body (bubbles), headings / rewards. */
export const FONT_SIZE = { sm: '11px', md: '13px', lg: '16px' } as const;

/** Every sign and tag on the map: ink on a translucent graphite chip. */
export const LABEL_BG = withAlpha('bg', 0.85);

/** Speech bubble tones: paper-white for speech, parchment for steps, the semantic colours for done and alert. */
export const BUBBLE_TONES = {
  speech: { fill: COLOR.bubble, stroke: COLOR.bg, text: CSS.bubbleInk, name: CSS.paperMeta },
  step: { fill: COLOR.highlight, stroke: COLOR.bg, text: CSS.quoteInk, name: CSS.paperMeta },
  done: { fill: COLOR.goodInk, stroke: COLOR.roleOk, text: CSS.bubbleInk, name: CSS.roleOk },
  alert: { fill: COLOR.badInk, stroke: 0x8f2a2e, text: CSS.bubbleInk, name: '#a32d31' },
} as const;

/** The common label style: 11 px, heavy, on the label chip. */
export const labelStyle = (font: string, color: string = CSS.inkHi, size: string = FONT_SIZE.sm): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: font,
  fontSize: size,
  fontStyle: '800',
  align: 'center',
  color,
  backgroundColor: LABEL_BG,
  padding: { x: 5, y: 2 },
});
