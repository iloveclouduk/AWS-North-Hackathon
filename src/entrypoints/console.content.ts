// Console Copilot — runs inside AWS console pages. It only acts while the player has started a
// Copilot task from the city, only on console pages, and never on risky controls or secret fields
// (src/console/safety.ts). Every action is shown (highlight + agent bubble) before it happens, paced
// by the player's speed setting, and held while they've paused.
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { choose, closeListbox, findExact, findTarget, isCustomSelect, matchOption, openListbox, optionsIn, press, typeInto } from '@/console/act';
import { Overlay } from '@/console/overlay';
import { Pacer, SPEED_KEY, SPEED_LABEL, nextSpeed, parseSpeed } from '@/console/pacing';
import { isConsoleUrl, mayAct, mayChoose } from '@/console/safety';
import { settle as settlePage } from '@/console/settle';
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

const YOUR_TURN_MS = 120_000;
const POINT_EXTRA_MS = 1200; // pointing steps have nothing to watch happen, so they stay up a bit longer

export default defineContentScript({
  matches: ['https://*.console.aws.amazon.com/*', 'https://console.aws.amazon.com/*'],
  runAt: 'document_idle',
  main() {
    if (!isConsoleUrl(location.href)) return;
    let overlay: Overlay | undefined;
    let pacer = new Pacer();

    // Speed lives in chrome.storage.local so it survives reloads and applies to every console tab.
    void browser.storage.local
      .get(SPEED_KEY)
      .then((r) => (pacer.speed = parseSpeed(r[SPEED_KEY])), () => {})
      .then(() => overlay?.setSpeedLabel(SPEED_LABEL[pacer.speed]));
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(SPEED_KEY in changes)) return;
      pacer.speed = parseSpeed(changes[SPEED_KEY]?.newValue);
      overlay?.setSpeedLabel(SPEED_LABEL[pacer.speed]);
    });

    const ensureOverlay = () => {
      if (overlay) return overlay;
      const o = new Overlay(document, {
        onStop: () => {
          pacer.stop();
          o.setPaused(false);
          o.show(undefined, { agent: 'AWS City', say: 'Stopped. Nothing else will be clicked.' });
          void browser.runtime.sendMessage({ type: 'copilot.stopRequested' }).catch(() => {});
          setTimeout(() => (overlay === o ? (o.destroy(), (overlay = undefined)) : undefined), 2500);
        },
        onPause: (p) => pacer.setPaused(p),
        onSpeed: () => {
          pacer.speed = nextSpeed(pacer.speed);
          o.setSpeedLabel(SPEED_LABEL[pacer.speed]);
          void browser.storage.local.set({ [SPEED_KEY]: pacer.speed }).catch(() => {});
        },
        onExplain: () => pacer.extend(Math.max(3000, pacer.readMs * 2)),
      });
      o.setSpeedLabel(SPEED_LABEL[pacer.speed]);
      o.setPaused(pacer.paused);
      return (overlay = o);
    };

    const settle = () => settlePage(document);

    /** Highlight the control and wait until the player uses it themselves. */
    const yourTurn = (el: Element | undefined, agent: string, say: string, why?: string) =>
      new Promise<StepResult>((resolve) => {
        ensureOverlay().show(el, { agent, say, why, yourTurn: true });
        if (!el) return resolve({ ok: false, note: 'not found' });
        // Cloudscape options select on mouseup and can vanish before a click event fires.
        const events = el.getAttribute('role') === 'option' ? ['click', 'change', 'mouseup'] : ['click', 'change'];
        const finish = (ok: boolean, note: string) => {
          for (const ev of events) el.removeEventListener(ev, onDone, true);
          clearTimeout(timer);
          clearInterval(watch);
          resolve({ ok, note });
        };
        const onDone = () => finish(true, 'player did it');
        for (const ev of events) el.addEventListener(ev, onDone, true);
        const timer = setTimeout(() => finish(false, 'player did not act'), YOUR_TURN_MS);
        const watch = setInterval(() => pacer.stopped && finish(false, 'stopped by player'), 250);
      });

    const stoppedResult = (): StepResult => ({ ok: false, note: 'stopped by player' });

    /** Phase two of a custom select: open the list like a person, check the exact option, click it. */
    async function selectCustom(trigger: Element, fieldName: string, value: string, agent: string, step: ConsoleStepEvent): Promise<StepResult> {
      const list = await openListbox(trigger);
      if (!list) return { ok: false, note: 'the list didn’t open', snapshot: takeSnapshot(document) };
      const opt = matchOption(optionsIn(list), value);
      if (!opt) {
        closeListbox(trigger);
        return { ok: false, note: `no option “${value}”`, snapshot: takeSnapshot(document) };
      }
      const v = mayChoose(opt, fieldName);
      if (!v.ok) {
        const r = await yourTurn(opt, agent, `${step.say} ${v.message}`, step.why);
        await settle();
        return { ...r, snapshot: takeSnapshot(document) };
      }
      ensureOverlay().show(opt, { agent, say: step.say, why: step.why });
      if (!(await pacer.hold(Math.round(pacer.readMs / 2)))) return (closeListbox(trigger), stoppedResult());
      if (!opt.isConnected) return { ok: false, note: 'the option disappeared', snapshot: takeSnapshot(document) };
      press(opt);
      await settle();
      return { ok: true, snapshot: takeSnapshot(document) };
    }

    async function runStep(step: ConsoleStepEvent, agent: string): Promise<StepResult> {
      if (pacer.stopped) return stoppedResult();
      const o = ensureOverlay();
      o.setStatus(`${agent} is working in your console`);
      if (step.action === 'done') {
        o.show(undefined, { agent, say: step.say, why: step.why });
        setTimeout(() => (overlay === o ? (o.destroy(), (overlay = undefined)) : undefined), 8000);
        return { ok: true };
      }
      const snap = takeSnapshot(document);
      // Pointing may use a name match; acting only ever uses the exact element from the snapshot.
      const el = step.target ? (step.action === 'point' ? findTarget(document, step.target) : findExact(document, step.target)) : undefined;
      const item = el ? snap.items.find((i) => i.id === el.getAttribute('data-awscity-id')) : undefined;

      if (step.action === 'point') {
        o.show(el, { agent, say: step.say, why: step.why });
        if (!(await pacer.hold(pacer.readMs + POINT_EXTRA_MS))) return stoppedResult();
        return { ok: true, snapshot: takeSnapshot(document) };
      }
      const verdict = mayAct(item, step.action, el, step.value);
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
      // The read time, "Explain again" extensions, and Pause all block here, before anything happens.
      if (!(await pacer.hold())) return stoppedResult();
      if (!el!.isConnected) return { ok: false, note: 'the page changed before I could act', snapshot: takeSnapshot(document) };
      try {
        if (step.action === 'select' && isCustomSelect(el!)) return await selectCustom(el!, item!.name, step.value ?? '', agent, step);
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
        // A new task: fresh pacing state, keeping the player's speed.
        const speed = pacer.speed;
        pacer = new Pacer();
        pacer.speed = speed;
        overlay?.setPaused(false);
        sendResponse({ ok: true, snapshot: takeSnapshot(document) });
        return;
      }
      if (msg?.type === 'copilot.step') {
        void runStep(msg.step, msg.agentName).then(sendResponse);
        return true; // async response
      }
      if (msg?.type === 'copilot.stop') {
        pacer.stop();
        if (msg.message) ensureOverlay().show(undefined, { agent: 'AWS City', say: msg.message });
        const o = overlay;
        setTimeout(() => (o && overlay === o ? (o.destroy(), (overlay = undefined)) : undefined), msg.message ? 4000 : 0);
        sendResponse({ ok: true });
      }
    });

    // Esc = stop, always (even while paused).
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') overlay?.stop();
    });
  },
});
