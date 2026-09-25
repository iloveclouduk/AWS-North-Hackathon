// In-page overlay on the AWS console: an orange pixel frame around the control the agent is about to
// use, the agent's speech bubble (what + why + "Explain again"), and an always-visible control chip
// (speed, Pause/Resume, Stop). Lives in a shadow root so the console's CSS can't touch it (and ours
// can't touch the console). Styled like the city's prototype UI: dark purple panels, orange accent, Nunito.

export interface Bubble {
  agent: string;
  say: string;
  why?: string;
  yourTurn?: boolean;
}

export interface OverlayControls {
  onStop: () => void;
  onPause?: (paused: boolean) => void;
  onSpeed?: () => void;
  onExplain?: () => void;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.frame { position: fixed; pointer-events: none; border: 3px solid #ffb84d; border-radius: 0;
  box-shadow: 0 0 0 3px #140d1f, 0 0 18px 4px rgba(255,184,77,.55); transition: all .25s ease; z-index: 2147483646; }
.frame.turn { border-color: #6fe3a3; box-shadow: 0 0 0 3px #140d1f, 0 0 18px 4px rgba(111,227,163,.6); animation: pulse 1s infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 3px #140d1f, 0 0 26px 8px rgba(111,227,163,.8); } }
.bubble { position: fixed; max-width: 330px; background: #241a37; color: #f5efe6; border: 2px solid #ffb84d;
  padding: 9px 11px; font: 700 13px/1.4 Nunito, system-ui, sans-serif; z-index: 2147483647;
  box-shadow: 0 0 0 2px #140d1f, 5px 5px 0 #140d1f; image-rendering: pixelated; }
.bubble b { color: #ffb84d; display: block; font-weight: 900; margin-bottom: 3px; letter-spacing: .02em; }
.bubble .why { margin-top: 7px; padding-top: 6px; border-top: 2px dashed #4a3768; font-weight: 600; color: #d9cdf5; }
.bubble .why::before { content: '💡 Why: '; font-weight: 800; color: #ffd166; }
.bubble .why.again { animation: flash 1.2s ease 2; }
@keyframes flash { 50% { background: #3a2a58; color: #fff; } }
.bubble .row { display: flex; justify-content: flex-end; margin-top: 7px; }
.bubble.turn { border-color: #6fe3a3; }
.bubble.turn b { color: #6fe3a3; }
button.px { all: unset; cursor: pointer; background: #2d2144; color: #f5efe6; border: 2px solid #4a3768; padding: 2px 8px;
  font: 800 11px Nunito, system-ui, sans-serif; box-shadow: 2px 2px 0 #140d1f; white-space: nowrap; }
button.px:hover { border-color: #ffb84d; color: #ffb84d; }
button.px:active { transform: translate(1px, 1px); box-shadow: 1px 1px 0 #140d1f; }
button.px.on { background: #ffb84d; color: #4a2e07; border-color: #ffb84d; }
button.px.stop { background: #ff6b6b; border-color: #ff6b6b; color: #fff; }
.chip { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; gap: 6px; align-items: center;
  background: #241a37; color: #f5efe6; border: 2px solid #4a3768; padding: 6px 8px 6px 10px;
  font: 800 12px Nunito, system-ui, sans-serif; box-shadow: 0 0 0 2px #140d1f, 4px 4px 0 #140d1f; }
.chip .label { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 4px; }
.chip .dot { width: 8px; height: 8px; background: #6fe3a3; box-shadow: 0 0 6px #6fe3a3; flex: none; }
.chip.paused .dot { background: #ffd166; box-shadow: 0 0 6px #ffd166; }
`;

/**
 * What the player sees for a control: radio tiles and styled checkboxes hide the native input
 * (1 px, opacity 0), so frame the label around it instead. Acting still uses the exact input.
 */
export function visualTarget(el: Element): Element {
  if (!(el instanceof HTMLInputElement)) return el;
  const r = el.getBoundingClientRect();
  const opacity = Number(el.ownerDocument.defaultView?.getComputedStyle(el).opacity ?? '1');
  if (r.width >= 6 && r.height >= 6 && opacity > 0.05) return el;
  const root = el.getRootNode() as Document | ShadowRoot;
  return el.closest('label') ?? (el.id ? root.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) ?? el;
}

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private frame: HTMLDivElement;
  private bubble: HTMLDivElement;
  private chip: HTMLDivElement;
  private speedBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;
  private target?: Element;
  private last?: Bubble;
  private raf = 0;
  private paused = false;

  constructor(
    private doc: Document,
    private controls: OverlayControls,
  ) {
    this.host = doc.createElement('div');
    this.host.setAttribute('data-awscity-overlay', '');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    this.frame = doc.createElement('div');
    this.frame.className = 'frame';
    this.bubble = doc.createElement('div');
    this.bubble.className = 'bubble';
    this.chip = doc.createElement('div');
    this.chip.className = 'chip';
    const dot = doc.createElement('span');
    dot.className = 'dot';
    const label = doc.createElement('span');
    label.className = 'label';
    label.textContent = 'AWS City Copilot';
    this.speedBtn = this.button('Speed: Normal', 'speed', () => this.controls.onSpeed?.());
    this.speedBtn.title = 'How long the agent waits so you can read each step';
    this.pauseBtn = this.button('⏸ Pause', 'pause', () => this.setPaused(!this.paused, true));
    this.pauseBtn.title = 'Hold the next action (Esc always stops)';
    const stop = this.button('■ Stop', 'stop', () => this.controls.onStop());
    stop.classList.add('stop');
    stop.title = 'Stop the Copilot (Esc)';
    this.chip.append(dot, label, this.speedBtn, this.pauseBtn, stop);
    this.root.append(style, this.frame, this.bubble, this.chip);
    this.hideFocus();
    doc.documentElement.appendChild(this.host);
    const loop = () => {
      this.place();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private button(text: string, name: string, onClick: () => void) {
    const b = this.doc.createElement('button');
    b.type = 'button';
    b.className = 'px';
    b.dataset.control = name;
    b.textContent = text;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  /** Same as pressing the Stop chip. */
  stop() {
    this.controls.onStop();
  }

  setStatus(text: string) {
    this.chip.querySelector('.label')!.textContent = this.paused ? `Paused — ${text}` : text;
  }

  setSpeedLabel(label: string) {
    this.speedBtn.textContent = `Speed: ${label}`;
  }

  get isPaused() {
    return this.paused;
  }

  setPaused(p: boolean, fromUser = false) {
    this.paused = p;
    this.pauseBtn.textContent = p ? '▶ Resume' : '⏸ Pause';
    this.pauseBtn.classList.toggle('on', p);
    this.chip.classList.toggle('paused', p);
    const label = this.chip.querySelector('.label')!;
    label.textContent = p ? 'Paused — press Resume' : 'AWS City Copilot';
    if (fromUser) this.controls.onPause?.(p);
  }

  show(target: Element | undefined, b: Bubble) {
    this.target = target && visualTarget(target);
    this.last = b;
    this.render(b, false);
    this.frame.style.display = target ? 'block' : 'none';
    this.bubble.style.display = 'block';
    (target as HTMLElement | undefined)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    this.place();
  }

  private render(b: Bubble, again: boolean) {
    this.frame.className = `frame${b.yourTurn ? ' turn' : ''}`;
    this.bubble.className = `bubble${b.yourTurn ? ' turn' : ''}`;
    this.bubble.replaceChildren();
    const name = this.doc.createElement('b');
    name.textContent = b.yourTurn ? `${b.agent} · your turn` : b.agent;
    const say = this.doc.createElement('div');
    say.textContent = b.say;
    this.bubble.append(name, say);
    if (b.why) {
      const why = this.doc.createElement('div');
      why.className = again ? 'why again' : 'why';
      why.textContent = b.why;
      const row = this.doc.createElement('div');
      row.className = 'row';
      row.append(this.button(again ? '💡 Take your time' : '💡 Explain again', 'explain', () => this.explainAgain()));
      this.bubble.append(why, row);
    }
  }

  /** Re-show the why (highlighted) and ask the Copilot to wait longer before acting. */
  explainAgain() {
    if (!this.last?.why) return;
    this.render(this.last, true);
    this.controls.onExplain?.();
  }

  hideFocus() {
    this.target = undefined;
    this.frame.style.display = 'none';
    this.bubble.style.display = 'none';
  }

  private place() {
    const vw = this.doc.defaultView?.innerWidth ?? 1200;
    if (!this.target || !this.target.isConnected) {
      if (this.target && !this.target.isConnected) this.frame.style.display = 'none';
      if (this.bubble.style.display !== 'none') Object.assign(this.bubble.style, { right: '16px', bottom: '70px', left: 'auto', top: 'auto' });
      return;
    }
    const r = this.target.getBoundingClientRect();
    Object.assign(this.frame.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    const left = Math.min(Math.max(8, r.left), vw - 350);
    const above = r.top > 170;
    Object.assign(this.bubble.style, above ? { left: `${left}px`, top: `${Math.max(8, r.top - 14 - this.bubble.offsetHeight)}px`, right: 'auto', bottom: 'auto' } : { left: `${left}px`, top: `${r.bottom + 14}px`, right: 'auto', bottom: 'auto' });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.host.remove();
  }
}
