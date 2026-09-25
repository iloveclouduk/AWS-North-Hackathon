// The Copilot's hard safety rules. They run in the content script, so they hold no matter what the
// model (or a compromised backend) asks for: risky controls become a "your turn" prompt, secrets are
// never typed or read, and only console pages are touched.
import type { SnapshotItem } from './types';

import { isRisky } from './risk';

export { isRisky };

const SENSITIVE_NAME = /(password|secret|token|access ?key|private ?key|credential|mfa|otp|card|cvv|iban)/i;

/** Inputs whose value must never be read or typed by the agent. */
export function isSensitiveInput(el: Element): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (type === 'password') return true;
  const hint = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder].join(' ');
  return SENSITIVE_NAME.test(hint);
}

/** Only real console pages — never sign-in, never other sites. */
export function isConsoleUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (/(^|\.)signin\.aws\.amazon\.com$/.test(u.hostname)) return false;
    return u.hostname === 'console.aws.amazon.com' || u.hostname.endsWith('.console.aws.amazon.com');
  } catch {
    return false;
  }
}

export type Verdict = { ok: true } | { ok: false; reason: 'risky' | 'sensitive' | 'missing' | 'disabled'; message: string };

/** Every label a control carries — a page could name a Delete button "Next" in one place but not all. */
export function riskSignals(el: Element): string {
  const h = el as HTMLElement;
  return [
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('data-testid'),
    el.getAttribute('name'),
    el.getAttribute('value'),
    el.getAttribute('class'),
    h.innerText ?? el.textContent,
    el.closest('form')?.getAttribute('action'),
    el.closest('[role=dialog]')?.querySelector('h1,h2,h3')?.textContent,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);
}

/** Links that leave the AWS console are never followed by the agent. */
export function leavesConsole(el: Element): boolean {
  const a = el.closest('a[href]') as HTMLAnchorElement | null;
  if (!a) return false;
  try {
    return !isConsoleUrl(new URL(a.getAttribute('href') ?? '', el.ownerDocument.location?.href).href);
  } catch {
    return true;
  }
}

/** Decide whether the agent may act on this element itself. */
export function mayAct(item: SnapshotItem | undefined, action: string, el?: Element, value?: string): Verdict {
  if (!item) return { ok: false, reason: 'missing', message: 'I can’t find that on the page.' };
  if (el && (action === 'click' || action === 'select')) {
    if (isRisky(riskSignals(el)) || /\b(danger|destructive|delete)\b/i.test(el.getAttribute('class') ?? ''))
      return { ok: false, reason: 'risky', message: `“${item.name}” looks like it can change or delete something important — your turn to click it.` };
    if (leavesConsole(el)) return { ok: false, reason: 'risky', message: 'That link leaves the AWS console — your turn if you want to follow it.' };
  }
  if (el && action === 'type' && isSensitiveInput(el)) return { ok: false, reason: 'sensitive', message: 'That field holds a secret — please fill it in yourself.' };
  // Typing is checked like clicking: delete dialogs ask you to type "delete"/the name to confirm, and
  // the agent must never fill those in.
  if (el && action === 'type' && (isRisky(riskSignals(el)) || isRisky(value ?? '') || /\b(confirm|to confirm)\b/i.test(riskSignals(el))))
    return { ok: false, reason: 'risky', message: 'This field confirms something important — please type it yourself.' };
  if (item.disabled) return { ok: false, reason: 'disabled', message: `“${item.name}” is disabled right now.` };
  if (item.sensitive) return { ok: false, reason: 'sensitive', message: 'That field holds a secret — please fill it in yourself.' };
  if ((action === 'click' || action === 'select' || action === 'type') && (isRisky(item.name, item.context) || isRisky(value ?? ''))) {
    return { ok: false, reason: 'risky', message: `“${item.name}” can change or cost something important — your turn to click it.` };
  }
  return { ok: true };
}
