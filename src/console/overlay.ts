// In-page overlay on the AWS console: an orange pixel frame around the control the agent is about to
// use, the agent's speech bubble (what + why), and an always-visible Stop chip. Lives in a shadow root
// so the console's CSS can't touch it (and ours can't touch the console).

export interface Bubble {
  agent: string;
  say: string;
  why?: string;
  yourTurn?: boolean;
}

const STYLE = `
:host { all: initial; }
.frame { position: fixed; pointer-events: none; border: 3px solid #ffb84d; border-radius: 6px;
  box-shadow: 0 0 0 3px #140d1f, 0 0 18px 4px rgba(255,184,77,.55); transition: all .25s ease; z-index: 2147483646; }
.frame.turn { border-color: #6fe3a3; box-shadow: 0 0 0 3px #140d1f, 0 0 18px 4px rgba(111,227,163,.6); animation: pulse 1s infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 3px #140d1f, 0 0 26px 8px rgba(111,227,163,.8); } }
.bubble { position: fixed; max-width: 320px; background: #fff; color: #161622; border: 2px solid #161622; border-radius: 8px;
  padding: 8px 10px; font: 700 13px/1.35 Nunito, system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,.35); z-index: 2147483647; }
.bubble b { color: #b45309; display: block; font-weight: 900; margin-bottom: 2px; }
.bubble .why { margin-top: 6px; font-weight: 600; color: #374151; }
.bubble .why::before { content: '💡 Why: '; font-weight: 800; }
.bubble.turn b { color: #15803d; }
.chip { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; gap: 8px; align-items: center;
  background: #241a37; color: #f5efe6; border: 1px solid #4a3768; border-radius: 999px; padding: 6px 8px 6px 12px;
  font: 800 12px Nunito, system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,.4); }
.chip button { all: unset; cursor: pointer; background: #ff6b6b; color: #fff; border-radius: 999px; padding: 4px 10px; font-weight: 900; }
.chip .dot { width: 8px; height: 8px; border-radius: 50%; background: #6fe3a3; box-shadow: 0 0 6px #6fe3a3; }
`;

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private frame: HTMLDivElement;
  private bubble: HTMLDivElement;
  private chip: HTMLDivElement;
  private target?: Element;
  private raf = 0;

  constructor(
    private doc: Document,
    private onStop: () => void,
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
    this.chip.innerHTML = '<span class="dot"></span><span class="label">AWS City Copilot</span><button type="button">Stop</button>';
    this.chip.querySelector('button')!.addEventListener('click', () => this.onStop());
    this.root.append(style, this.frame, this.bubble, this.chip);
    this.hideFocus();
    doc.documentElement.appendChild(this.host);
    const loop = () => {
      this.place();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Same as pressing the Stop chip. */
  stop() {
    this.onStop();
  }

  setStatus(text: string) {
    this.chip.querySelector('.label')!.textContent = text;
  }

  show(target: Element | undefined, b: Bubble) {
    this.target = target;
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
      why.className = 'why';
      why.textContent = b.why;
      this.bubble.append(why);
    }
    this.frame.style.display = target ? 'block' : 'none';
    this.bubble.style.display = 'block';
    (target as HTMLElement | undefined)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    this.place();
  }

  hideFocus() {
    this.target = undefined;
    this.frame.style.display = 'none';
    this.bubble.style.display = 'none';
  }

  private place() {
    const vw = this.doc.defaultView?.innerWidth ?? 1200;
    if (!this.target || !this.target.isConnected) {
      if (this.bubble.style.display !== 'none') Object.assign(this.bubble.style, { right: '16px', bottom: '64px', left: 'auto', top: 'auto' });
      return;
    }
    const r = this.target.getBoundingClientRect();
    Object.assign(this.frame.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    const left = Math.min(Math.max(8, r.left), vw - 340);
    const above = r.top > 150;
    Object.assign(this.bubble.style, above ? { left: `${left}px`, top: `${Math.max(8, r.top - 12 - this.bubble.offsetHeight)}px`, right: 'auto', bottom: 'auto' } : { left: `${left}px`, top: `${r.bottom + 14}px`, right: 'auto', bottom: 'auto' });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.host.remove();
  }
}
