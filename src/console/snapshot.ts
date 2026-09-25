// What the agent can "see" on a console page: visible interactive elements with their accessible names.
// Labels only — values of secret fields are never read.
import { isSensitiveInput } from './safety';
import type { PageSnapshot, SnapshotItem } from './types';

const ID_ATTR = 'data-awscity-id';
const INTERACTIVE = [
  'button', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea',
  '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=tab]', '[role=menuitem]',
  '[role=option]', '[role=switch]', '[role=combobox]', '[role=menuitemradio]',
].join(',');
const MAX_ITEMS = 160;
let counter = 0;

const clean = (s: string | null | undefined, max = 80) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function roleOf(el: Element): string {
  const r = el.getAttribute('role');
  if (r) return r;
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

export function accessibleName(el: Element): string {
  const doc = el.ownerDocument;
  const label = el.getAttribute('aria-label');
  if (label) return clean(label);
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? '').join(' ');
    if (clean(t)) return clean(t);
  }
  if (el.id) {
    const lab = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lab && clean(lab.textContent)) return clean(lab.textContent);
  }
  const wrap = el.closest('label');
  if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
  const text = clean((el as HTMLElement).innerText ?? el.textContent);
  if (text) return text;
  return clean(el.getAttribute('placeholder') ?? el.getAttribute('title') ?? (el as HTMLInputElement).value ?? '');
}

function contextOf(el: Element): string | undefined {
  const box = el.closest('fieldset, section, form, [role=region], [role=dialog], [role=group]');
  const h = box?.querySelector('legend, h1, h2, h3, h4, [role=heading]');
  return clean(h?.textContent, 60) || undefined;
}

function visible(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.hidden || h.closest('[aria-hidden=true], [hidden]')) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(h);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const r = h.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export interface SnapshotOptions {
  /** jsdom has no layout; tests turn the size check off. */
  requireLayout?: boolean;
}

export function takeSnapshot(doc: Document, opts: SnapshotOptions = {}): PageSnapshot {
  const requireLayout = opts.requireLayout ?? true;
  const items: SnapshotItem[] = [];
  for (const el of doc.querySelectorAll(INTERACTIVE)) {
    if (items.length >= MAX_ITEMS) break;
    if (requireLayout ? !visible(el) : (el as HTMLElement).hidden || el.closest('[aria-hidden=true], [hidden]')) continue;
    if (el.closest('[data-awscity-overlay]')) continue; // our own overlay
    const name = accessibleName(el);
    const role = roleOf(el);
    if (!name && role !== 'textbox') continue;
    let id = el.getAttribute(ID_ATTR);
    if (!id) {
      id = `e${++counter}`;
      el.setAttribute(ID_ATTR, id);
    }
    const sensitive = isSensitiveInput(el);
    const input = el as HTMLInputElement;
    const item: SnapshotItem = { id, role, name: name || '(unlabelled field)', context: contextOf(el) };
    if (sensitive) item.sensitive = true;
    else if (role === 'textbox' || role === 'combobox') item.value = clean(input.value, 60) || undefined;
    if (role === 'checkbox' || role === 'radio' || role === 'switch') item.checked = input.checked ?? el.getAttribute('aria-checked') === 'true';
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    items.push(item);
  }
  const heading = clean(doc.querySelector('h1, [role=heading][aria-level="1"]')?.textContent, 80) || undefined;
  return { url: doc.location?.href ?? '', title: clean(doc.title, 120), heading, items };
}

export const elementFor = (doc: Document, id: string) => doc.querySelector(`[${ID_ATTR}="${CSS.escape(id)}"]`);
