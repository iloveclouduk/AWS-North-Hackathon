// Console Copilot — runs inside AWS console pages. It only acts while the player has started a
// Copilot task from the city, only on console pages, and never on risky controls or secret fields
// (src/console/safety.ts). Every action is shown (highlight + agent bubble) before it happens.
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { choose, findTarget, press, typeInto } from '@/console/act';
import { Overlay } from '@/console/overlay';
import { isConsoleUrl, mayAct } from '@/console/safety';
import { takeSnapshot } from '@/console/snapshot';
import type { ConsoleStepEvent } from '@/backend/contract';

export type CopilotMessage =
  | { type: 'copilot.snapshot' }
  | { type: 'copilot.step'; step: ConsoleStepEvent; agentName: string }
  | { type: 'copilot.stop'; message?: string };

export interface StepResult {
  ok: boolean;
  note?: string;
  snapshot?: ReturnType<typeof takeSnapshot>;
}

const READ_MS = 1400; // time to read the bubble before the agent acts
const YOUR_TURN_MS = 120_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default defineContentScript({
  matches: ['https://*.console.aws.amazon.com/*', 'https://console.aws.amazon.com/*'],
  runAt: 'document_idle',
  main() {
    if (!isConsoleUrl(location.href)) return;
    let overlay: Overlay | undefined;
    let stopped = false;

    const ensureOverlay = () =>
      (overlay ??= new Overlay(document, () => {
        stopped = true;
        overlay?.show(undefined, { agent: 'AWS City', say: 'Stopped. Nothing else will be clicked.' });
        void browser.runtime.sendMessage({ type: 'copilot.stopRequested' }).catch(() => {});
        setTimeout(() => (overlay?.destroy(), (overlay = undefined)), 2500);
      }));

    const settle = async () => {
      // wait for the SPA to finish reacting (no DOM changes for ~400 ms, max 4 s)
      await new Promise<void>((resolve) => {
        let t = setTimeout(done, 400);
        const obs = new MutationObserver(() => {
          clearTimeout(t);
          t = setTimeout(done, 400);
        });
        const cap = setTimeout(done, 4000);
        function done() {
          obs.disconnect();
          clearTimeout(cap);
          resolve();
        }
        obs.observe(document.body, { subtree: true, childList: true, attributes: true });
      });
    };

    /** Highlight the control and wait until the player uses it themselves. */
    const yourTurn = (el: Element | undefined, agent: string, say: string, why?: string) =>
      new Promise<StepResult>((resolve) => {
        ensureOverlay().show(el, { agent, say, why, yourTurn: true });
        if (!el) return resolve({ ok: false, note: 'not found' });
        const finish = (ok: boolean, note: string) => {
          el.removeEventListener('click', onDone, true);
          el.removeEventListener('change', onDone, true);
          clearTimeout(timer);
          resolve({ ok, note });
        };
        const onDone = () => finish(true, 'player did it');
        el.addEventListener('click', onDone, true);
        el.addEventListener('change', onDone, true);
        const timer = setTimeout(() => finish(false, 'player did not act'), YOUR_TURN_MS);
      });

    async function runStep(step: ConsoleStepEvent, agent: string): Promise<StepResult> {
      if (stopped) return { ok: false, note: 'stopped by player' };
      const o = ensureOverlay();
      o.setStatus(`${agent} is working in your console`);
      if (step.action === 'done') {
        o.show(undefined, { agent, say: step.say, why: step.why });
        setTimeout(() => (overlay?.destroy(), (overlay = undefined)), 8000);
        return { ok: true };
      }
      const snap = takeSnapshot(document);
      const el = step.target ? findTarget(document, step.target) : undefined;
      const item = el ? snap.items.find((i) => i.id === el.getAttribute('data-awscity-id')) : undefined;

      if (step.action === 'point') {
        o.show(el, { agent, say: step.say, why: step.why });
        await wait(READ_MS + 1200);
        return { ok: true, snapshot: takeSnapshot(document) };
      }
      const verdict = mayAct(item, step.action);
      if (!verdict.ok && verdict.reason === 'missing') {
        o.show(undefined, { agent, say: `I can’t find “${step.target?.name}” on this page.`, why: step.why });
        return { ok: false, note: 'not found', snapshot: snap };
      }
      if (!verdict.ok || step.risk === 'confirm') {
        const msg = verdict.ok ? `${step.say} This one needs your OK — please click it yourself.` : `${step.say} ${verdict.message}`;
        const r = await yourTurn(el, agent, msg, step.why);
        await settle();
        return { ...r, snapshot: takeSnapshot(document) };
      }
      o.show(el, { agent, say: step.say, why: step.why });
      await wait(READ_MS);
      if (stopped) return { ok: false, note: 'stopped by player' };
      try {
        if (step.action === 'click') press(el!);
        else if (step.action === 'type') typeInto(el!, step.value ?? '');
        else if (step.action === 'select') choose(el!, step.value);
      } catch (err) {
        return { ok: false, note: String(err), snapshot: takeSnapshot(document) };
      }
      await settle();
      return { ok: true, snapshot: takeSnapshot(document) };
    }

    browser.runtime.onMessage.addListener((msg: CopilotMessage, _sender, sendResponse) => {
      if (msg?.type === 'copilot.snapshot') {
        stopped = false;
        sendResponse({ ok: true, snapshot: takeSnapshot(document) });
        return;
      }
      if (msg?.type === 'copilot.step') {
        void runStep(msg.step, msg.agentName).then(sendResponse);
        return true; // async response
      }
      if (msg?.type === 'copilot.stop') {
        stopped = true;
        if (msg.message) ensureOverlay().show(undefined, { agent: 'AWS City', say: msg.message });
        setTimeout(() => (overlay?.destroy(), (overlay = undefined)), msg.message ? 4000 : 0);
        sendResponse({ ok: true });
      }
    });

    // Esc = stop, always.
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') overlay?.stop();
    });
  },
});
