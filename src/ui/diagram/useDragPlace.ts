// Drag a service card onto a diagram slot, with no library. A mouse or pen drags after 4 px. On touch a
// quick tap picks the card up (then tap a spot) and a 250 ms press drags, so the panel still scrolls normally.
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';

interface Press {
  svc: string;
  pointerId: number;
  el: HTMLElement;
  x0: number;
  y0: number;
  touch: boolean;
  dragging: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const SNAP_PX = 40;
/** Stops the panel scrolling under a finger that is dragging a card. */
const noScroll = (e: TouchEvent) => e.preventDefault();

/** The slot under or nearest (within SNAP_PX) a screen point. */
export function nearestSlot(slots: Map<string, HTMLElement>, x: number, y: number): string | undefined {
  let best: string | undefined;
  let bestD = SNAP_PX;
  for (const [id, el] of slots) {
    const r = el.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d < bestD || (d === 0 && bestD === 0)) [best, bestD] = [id, d];
  }
  return best;
}

export function useDragPlace(opts: { slots: RefObject<Map<string, HTMLElement>>; onDrop: (slotId: string, svc: string) => void; onTap: (svc: string, viaKeyboard: boolean) => void }) {
  const [ghost, setGhost] = useState<{ svc: string; x: number; y: number }>();
  const [over, setOver] = useState<string>();
  const press = useRef<Press>(undefined);
  const suppressClick = useRef(false);
  const latest = useRef(opts);
  latest.current = opts;

  const end = () => {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    if (p?.dragging && p.el.hasPointerCapture(p.pointerId)) p.el.releasePointerCapture(p.pointerId);
    document.removeEventListener('touchmove', noScroll);
    press.current = undefined;
    setGhost(undefined);
    setOver(undefined);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press.current?.dragging) end();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      end();
    };
  }, []);

  const begin = (p: Press, x: number, y: number) => {
    p.dragging = true;
    p.el.setPointerCapture(p.pointerId);
    if (p.touch) document.addEventListener('touchmove', noScroll, { passive: false });
    setGhost({ svc: p.svc, x, y });
  };

  const cardProps = (svc: string) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      suppressClick.current = false;
      const p: Press = { svc, pointerId: e.pointerId, el: e.currentTarget, x0: e.clientX, y0: e.clientY, touch: e.pointerType === 'touch', dragging: false };
      if (p.touch) p.timer = setTimeout(() => press.current === p && begin(p, p.x0, p.y0), 250);
      press.current = p;
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
      if (!p.dragging) {
        if (p.touch && moved > 8) end(); // the finger is scrolling the panel
        else if (!p.touch && moved > 4) begin(p, e.clientX, e.clientY);
        return;
      }
      setGhost({ svc: p.svc, x: e.clientX, y: e.clientY });
      setOver(nearestSlot(latest.current.slots.current, e.clientX, e.clientY));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      if (p.dragging) {
        suppressClick.current = true;
        const target = nearestSlot(latest.current.slots.current, e.clientX, e.clientY);
        if (target) latest.current.onDrop(target, p.svc);
      }
      end();
    },
    onPointerCancel: () => end(),
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      latest.current.onTap(svc, e.detail === 0);
    },
  });

  return { ghost, over, cardProps };
}
