import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog's keyboard contract, in one place: focus moves in when it opens (to `initial`, else the first
 * control), Tab and Shift+Tab stay inside, Escape closes it from anywhere on the page, and focus goes back to what
 * had it before.
 */
export function useDialog(open: boolean, box: RefObject<HTMLElement | null>, onClose: () => void, initial?: RefObject<HTMLElement | null>) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const focusables = () => [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => !el.closest('[inert]'));
    (initial?.current ?? focusables()[0] ?? box.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // A popover inside (a glossary term) handles its own Escape first and stops it.
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !box.current) return;
      const els = focusables();
      if (!els.length) return e.preventDefault();
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !box.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !box.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Back to where the player was, if it's still on the page.
      if (before?.isConnected) before.focus();
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
