// Performing one step on the page, the way a person would: find, scroll, click / type / choose.
import { byIdFrom, deepElements, deepQueryAll } from './dom';
import { isSensitiveInput, optionFor } from './safety';
import { accessibleName, elementFor, optionLabel } from './snapshot';
import type { ConsoleTarget } from './types';

/**
 * For acting, only the exact element the agent saw (snapshot id) counts — no fuzzy name matching, so a
 * page can't redirect an action to a look-alike control. Name matching is only used for highlighting.
 */
export function findExact(doc: Document, t: ConsoleTarget): Element | undefined {
  return t.id ? (elementFor(doc, t.id) ?? undefined) : undefined;
}

export function findTarget(doc: Document, t: ConsoleTarget): Element | undefined {
  if (t.id) {
    const byId = elementFor(doc, t.id);
    if (byId) return byId;
  }
  const want = t.name.toLowerCase().trim();
  if (!want) return undefined;
  const candidates = deepQueryAll(doc, '[data-awscity-id]');
  const exact = candidates.filter((el) => accessibleName(el).toLowerCase() === want);
  return exact[0] ?? candidates.find((el) => accessibleName(el).toLowerCase().includes(want));
}

/** Set a value so React-controlled inputs (the AWS console's Cloudscape components) notice it. */
export function typeInto(el: Element, value: string) {
  if (isSensitiveInput(el)) throw new Error('refusing to type into a secret field');
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error('that is not a text field');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus();
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur?.();
}

/** A native <select>: pick the exact option that passed the safety check (optionFor). */
export function choose(el: Element, value?: string) {
  if (el instanceof HTMLSelectElement && value !== undefined) {
    const opt = optionFor(el, value);
    if (!opt) throw new Error(`no option “${value}”`);
    // Select the checked option itself: el.value = opt.value would pick the first option sharing that value.
    el.selectedIndex = opt.index;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  press(el);
}

/**
 * Click like a person: pointer/mouse down and up, then click. Cloudscape needs the full sequence — its
 * select trigger opens on mousedown and its options list selects on mouseup
 * (select/utils/use-select.ts getTriggerProps / getMenuProps), so a bare el.click() does nothing there.
 */
export function press(el: Element) {
  const h = el as HTMLElement;
  h.scrollIntoView?.({ block: 'center', behavior: 'instant' as ScrollBehavior });
  const view = el.ownerDocument.defaultView;
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  const Pointer = view && 'PointerEvent' in view ? (view.PointerEvent as typeof PointerEvent) : undefined;
  const Mouse = (view?.MouseEvent ?? MouseEvent) as typeof MouseEvent;
  if (Pointer) el.dispatchEvent(new Pointer('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new Mouse('mousedown', { ...at, buttons: 1 }));
  if (Pointer) el.dispatchEvent(new Pointer('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new Mouse('mouseup', at));
  // The mouseup may have removed the element (a Cloudscape option closes its list): only click what's still there.
  if (el.isConnected) h.click();
}

// ── Custom (Cloudscape) selects ─────────────────────────────────────────────

/** A dropdown that isn't a native <select>: a Cloudscape select trigger or an ARIA combobox. */
export function isCustomSelect(el: Element): boolean {
  if (el instanceof HTMLSelectElement) return false;
  return el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('role') === 'combobox';
}

const shown = (el: Element) => {
  if ((el as HTMLElement).hidden || el.closest('[hidden], [aria-hidden=true]')) return false;
  const st = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !st || (st.display !== 'none' && st.visibility !== 'hidden');
};

/** The open listbox this trigger controls (aria-controls/aria-owns, else a nearby one, else the only one open). */
export function listboxFor(trigger: Element): Element | undefined {
  const asListbox = (el: Element | undefined) => (el ? (el.matches('[role=listbox]') ? el : el.querySelector('[role=listbox]') ?? undefined) : undefined);
  for (const attr of ['aria-controls', 'aria-owns']) {
    for (const id of (trigger.getAttribute(attr) ?? '').split(/\s+/)) {
      const lb = asListbox(byIdFrom(trigger, id));
      if (lb && shown(lb)) return lb;
    }
  }
  let p = trigger.parentElement;
  for (let depth = 0; p && depth < 4; depth++, p = p.parentElement) {
    const lb = [...p.querySelectorAll('[role=listbox]')].find(shown);
    if (lb) return lb;
  }
  // expandToViewport portals the list to <body>: accept it only when exactly one list is open.
  const open = deepQueryAll(trigger.ownerDocument, '[role=listbox]').filter(shown);
  return open.length === 1 ? open[0] : undefined;
}

export function optionsIn(listbox: Element): Element[] {
  return [...deepElements(listbox)].filter((el) => el.matches('[role=option]') && shown(el));
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The one option whose label (or full text) equals the value; failing that, the one option whose text
 * starts with it as a whole word. Ambiguous matches pick nothing — never a guess.
 */
export function matchOption(options: Element[], value: string): Element | undefined {
  const want = norm(value);
  if (!want) return undefined;
  const exact = options.filter((o) => norm(optionLabel(o)) === want || norm(o.textContent ?? '') === want || o.getAttribute('data-value') === value);
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  const prefix = options.filter((o) => {
    const t = norm(optionLabel(o));
    return t.startsWith(want) && !/[a-z0-9]/.test(t.charAt(want.length));
  });
  return prefix.length === 1 ? prefix[0] : undefined;
}

/** Phase one of a custom select: open the list the way a person does and wait for its options. */
export async function openListbox(trigger: Element, timeoutMs = 3000): Promise<Element | undefined> {
  const ready = () => {
    const lb = listboxFor(trigger);
    return lb && optionsIn(lb).length ? lb : undefined;
  };
  if (trigger.getAttribute('aria-expanded') !== 'true' || !ready()) press(trigger);
  for (let t = 0; t < timeoutMs; t += 100) {
    const lb = ready();
    if (lb) return lb;
    await new Promise((r) => setTimeout(r, 100));
  }
  return ready();
}

/** Close a list we opened but won't use (clicking the trigger again, like a person). */
export function closeListbox(trigger: Element) {
  if (trigger.isConnected && trigger.getAttribute('aria-expanded') === 'true') press(trigger);
}
