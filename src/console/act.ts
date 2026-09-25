// Performing one step on the page, the way a person would: find, scroll, click / type / choose.
import { isSensitiveInput, optionFor } from './safety';
import { accessibleName, elementFor } from './snapshot';
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
  const candidates = [...doc.querySelectorAll('[data-awscity-id]')];
  const exact = candidates.filter((el) => accessibleName(el).toLowerCase() === want);
  return exact[0] ?? candidates.find((el) => accessibleName(el).toLowerCase().includes(want));
}

/** Set a value so React-controlled inputs (the AWS console's Cloudscape components) notice it. */
export function typeInto(el: Element, value: string) {
  if (isSensitiveInput(el)) throw new Error('refusing to type into a secret field');
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  input.focus();
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur?.();
}

export function choose(el: Element, value?: string) {
  if (el instanceof HTMLSelectElement && value !== undefined) {
    const opt = optionFor(el, value);
    if (!opt) throw new Error(`no option “${value}”`);
    // Select the checked option itself: el.value = opt.value would pick the first option sharing that value.
    el.selectedIndex = opt.index;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  (el as HTMLElement).click();
}

export function press(el: Element) {
  (el as HTMLElement).scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  (el as HTMLElement).click();
}
