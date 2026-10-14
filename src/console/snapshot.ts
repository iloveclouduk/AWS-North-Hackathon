// What the agent can "see" on a console page: visible interactive elements with their accessible names.
// Labels only — typed values never leave the page, and all text is redacted (src/console/risk.ts).
// Understands Cloudscape (the AWS console's design system): custom selects (a button trigger with
// aria-haspopup=listbox + a role=listbox of role=option), radio tiles, form-field labels, and widgets
// rendered inside open shadow roots.
import { byIdFrom, deepElements, deepQuery, rootOf } from './dom';
import { redact } from './risk';
import { isSensitiveInput } from './safety';
import type { PageSnapshot, SnapshotItem } from './types';

const ID_ATTR = 'data-awscity-id';
export const INTERACTIVE = [
  'button', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea',
  '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=tab]', '[role=menuitem]',
  '[role=option]', '[role=switch]', '[role=combobox]', '[role=listbox]', '[role=menuitemradio]',
  '[aria-haspopup=listbox]', '[class*="awsui_"][tabindex="0"]', '[class*="awsui_"][role=button]',
].join(',');
const MAX_ITEMS = 160;
let counter = 0;

const raw = (s: string | null | undefined, max = 80) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Everything that leaves the page is redacted (account IDs, keys, emails, tokens). */
const clean = (s: string | null | undefined, max = 80) => redact(raw(s, max));
const textOf = (el: Element) => (el as HTMLElement).innerText ?? el.textContent ?? '';

function roleOf(el: Element): string {
  const r = el.getAttribute('role');
  if (r) return r;
  if (el.getAttribute('aria-haspopup') === 'listbox') return 'combobox'; // a Cloudscape select trigger
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (t === 'checkbox' || t === 'radio') return t;
    if (t === 'submit' || t === 'button') return 'button';
    return 'textbox';
  }
  return tag;
}

const isFormControl = (el: Element) =>
  el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || roleOf(el) === 'combobox';

/**
 * The Cloudscape form-field label for a control: the closest `[class*="awsui_form-field"]`'s label, or
 * (Cloudscape class names are hashed, e.g. `awsui_label_14mhv_…`) the nearest small ancestor that holds
 * exactly this one control and a `<label>`.
 */
function formFieldLabel(el: Element): string {
  const ff = el.closest('[class*="awsui_form-field"]');
  const lab = ff?.querySelector('label, [class*="awsui_label"]');
  if (lab && clean(textOf(lab))) return clean(textOf(lab));
  let p = el.parentElement;
  for (let depth = 0; p && depth < 4; depth++, p = p.parentElement) {
    const l = p.querySelector(':scope > label, :scope > * > label');
    if (l && !l.contains(el) && p.querySelectorAll(INTERACTIVE).length === 1 && clean(textOf(l))) return clean(textOf(l));
  }
  return '';
}

/** The combobox / select trigger that owns a listbox (aria-controls/aria-owns, else the nearest trigger around it). */
export function comboboxFor(listbox: Element): Element | undefined {
  const root = rootOf(listbox);
  if (listbox.id) {
    const esc = CSS.escape(listbox.id);
    const owner = root.querySelector(`[aria-controls~="${esc}"], [aria-owns~="${esc}"]`) ?? listbox.ownerDocument.querySelector(`[aria-controls~="${esc}"], [aria-owns~="${esc}"]`);
    if (owner && owner !== listbox) return owner;
  }
  let p = listbox.parentElement;
  for (let depth = 0; p && depth < 5; depth++, p = p.parentElement) {
    const trigger = p.querySelector('[aria-haspopup=listbox], [role=combobox], select');
    if (trigger && trigger !== listbox && !listbox.contains(trigger)) return trigger;
  }
  return undefined;
}

/** A Cloudscape option's own label (without its description), falling back to its text. */
export function optionLabel(opt: Element): string {
  return clean(opt.getAttribute('aria-label') || opt.querySelector('[class*="awsui_label"]')?.textContent || textOf(opt));
}

export function accessibleName(el: Element): string {
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => byIdFrom(el, id)?.textContent ?? '').join(' ');
    if (clean(t)) return clean(t);
  }
  const label = el.getAttribute('aria-label');
  if (label && clean(label)) return clean(label);
  if (el.getAttribute('role') === 'option') return clean(textOf(el));
  if (el.id) {
    const esc = CSS.escape(el.id);
    const lab = rootOf(el).querySelector(`label[for="${esc}"]`);
    if (lab && clean(textOf(lab))) return clean(textOf(lab));
  }
  const wrap = el.closest('label');
  if (wrap && clean(textOf(wrap))) return clean(textOf(wrap));
  // A select trigger's own text is its current value; the field label says what it is.
  if (isFormControl(el)) {
    const ff = formFieldLabel(el);
    if (ff) return ff;
  }
  const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? '' : clean(textOf(el));
  if (text) return text;
  // never fall back to an input's typed value — only static hints
  return clean(el.getAttribute('placeholder') || el.getAttribute('title') || '');
}

function contextOf(el: Element): string | undefined {
  if (el.getAttribute('role') === 'option') {
    const lb = el.closest('[role=listbox]');
    const cb = lb && comboboxFor(lb);
    if (cb) return clean(accessibleName(cb), 60) || undefined;
  }
  const box = el.closest('fieldset, section, form, [role=region], [role=dialog], [role=group], [class*="awsui_container"]');
  const h = box?.querySelector('legend, h1, h2, h3, h4, [role=heading]');
  return clean(h?.textContent, 60) || undefined;
}

function hiddenByTree(el: Element): boolean {
  return (el as HTMLElement).hidden || !!el.closest('[aria-hidden=true], [hidden]');
}

function laidOut(el: Element): boolean {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function visible(el: Element, requireLayout: boolean): boolean {
  if (hiddenByTree(el)) return false;
  if (!requireLayout) return true;
  if (laidOut(el)) return true;
  // Radio tiles / styled checkboxes hide the native input; the label the player sees counts.
  const wrap = el instanceof HTMLInputElement ? el.closest('label') ?? (el.id ? rootOf(el).querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) : null;
  return !!wrap && laidOut(wrap);
}

export interface SnapshotOptions {
  /** jsdom has no layout; tests turn the size check off. */
  requireLayout?: boolean;
}

export function takeSnapshot(doc: Document, opts: SnapshotOptions = {}): PageSnapshot {
  const requireLayout = opts.requireLayout ?? true;
  const items: SnapshotItem[] = [];
  for (const el of deepElements(doc)) {
    if (items.length >= MAX_ITEMS) break;
    if (!el.matches(INTERACTIVE)) continue;
    if (el.closest('[data-awscity-overlay]')) continue; // our own overlay
    if (!visible(el, requireLayout)) continue;
    const name = accessibleName(el);
    const role = roleOf(el);
    if (!name && role !== 'textbox') continue;
    let id = el.getAttribute(ID_ATTR);
    if (!id) {
      id = `e${++counter}`;
      el.setAttribute(ID_ATTR, id);
    }
    const sensitive = isSensitiveInput(el);
    const item: SnapshotItem = { id, role, name: name || '(unlabelled field)', context: contextOf(el) };
    if (sensitive) item.sensitive = true;
    // Typed values never leave the page; the agent only learns whether a field is filled.
    else if ((role === 'textbox' || role === 'combobox') && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement))
      item.value = el.value ? '(filled)' : undefined;
    if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      item.checked = el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true';
    }
    if (role === 'option' || role === 'tab') {
      const sel = el.getAttribute('aria-selected');
      if (sel !== null) item.checked = sel === 'true';
    }
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    items.push(item);
  }
  const heading = clean(deepQuery(doc, 'h1, [role=heading][aria-level="1"]')?.textContent, 80) || undefined;
  return { url: doc.location?.href ?? '', title: clean(doc.title, 120), heading, items };
}

/** The element with this snapshot id — in the page or inside any open shadow root. */
export const elementFor = (doc: Document, id: string): Element | null =>
  deepQuery(doc, `[${ID_ATTR}="${CSS.escape(id)}"]`) ?? null;
