import { useCallback, useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react';

/** Horizontally scrolling suggestion chips; the edge with more chips behind it fades out as a hint. */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  // Vertical wheel scrolls the row sideways (mouse users can't otherwise reach the hidden chips).
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
  };
  return (
    <div
      ref={ref}
      className={`chips ${edges.left ? 'more-left' : ''} ${edges.right ? 'more-right' : ''}`}
      role="group"
      aria-label={label}
      onScroll={measure}
      onWheel={onWheel}
    >
      {children}
    </div>
  );
}
