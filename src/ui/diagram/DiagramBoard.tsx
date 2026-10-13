import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { isFilled, shortName, slotName, slotsOf, type Placements, type Slot } from '@/learning/diagram';
import { reducedMotion } from '@/game/motion';
import type { DiagramEdge, DiagramGroup, DiagramNode, Puzzle } from '@/world/content';
import { REGIONS } from '@/world/culture';
import { actorIconPath, groupIconPath, iconPath, productIconPath, productName } from '@/world/icons';
import { districtById, hexColor, serviceById } from '@/world/taxonomy';
import { arrowHead, BADGE, badgeAt, BOX, edgePoints, groupRect, nodeCenter, nextSlot, pathD, pointAt, twoLines, viewBox, type ArrowKey, type Pt } from './geometry';

/** AWS diagram group colours (lightened where the official one disappears on our dark panel). */
const GROUP_COLOR: Record<DiagramGroup['kind'], string> = {
  cloud: '#c9c4b8',
  region: '#00a4a6',
  vpc: '#8c4fff',
  az: '#00a4a6',
  public: '#7aa116',
  private: '#00a4a6',
  edge: '#8c4fff',
  generic: '#8b8f98',
};
const DASHED = new Set<DiagramGroup['kind']>(['region', 'az', 'edge', 'generic']);

export const serviceColor = (id?: string) => {
  const d = id ? districtById(serviceById(id)?.districtId ?? '') : undefined;
  return d ? hexColor(d.color) : '#8b8f98';
};
const cityLabel = (s: string) => s.replace('{cityRegion}', REGIONS.cityRegion);

export interface FlowPlay {
  /** Indices into `edges` that are moving right now. */
  active: number[];
  /** Indices already travelled (drawn lit). */
  lit: Set<number>;
  /** False: show the step without moving packets (reduced motion / manual stepping). */
  animate: boolean;
  onDone: () => void;
}

interface Props {
  puzzle: Puzzle;
  placements: Placements;
  edges: DiagramEdge[];
  armed?: string;
  hinted?: string;
  rejected?: string;
  dragOver?: string;
  play?: FlowPlay;
  /** The number shown on a step badge (renumbered while the flow plays); default: the step itself. */
  stepLabel?: (step: number) => number;
  onSlot: (slotId: string) => void;
  onRemove: (slotId: string) => void;
  slotRef: (slotId: string, el: HTMLButtonElement | null) => void;
}

const STEP_MS = 700;

/** The puzzle drawn as an AWS architecture diagram: group boxes, actors, slots and the arrows between them. */
export function DiagramBoard({ puzzle, placements, edges, armed, hinted, rejected, dragOver, play, stepLabel, onSlot, onRemove, slotRef }: Props) {
  const d = puzzle.diagram!;
  const { w, h } = viewBox(d);
  const slots = useMemo(() => slotsOf(puzzle), [puzzle]);
  const byId = useMemo(() => new Map(d.nodes.map((n) => [n.id, n])), [d]);
  const paths = useMemo(() => edges.map((e) => edgePoints(d, e)), [d, edges]);
  const packets = useRef<(SVGRectElement | null)[]>([]);
  const btns = useRef(new Map<string, HTMLButtonElement>());

  // The latest play, read when a step finishes: onDone changes identity every render, and the step
  // (not a new callback) is what restarts the run, so calling the one captured at the start went stale.
  const playRef = useRef(play);
  useEffect(() => {
    playRef.current = play;
  });
  const stepKey = play?.active.join(',') ?? '';
  const animate = play?.animate ?? false;

  // Move the packets of the current step along their arrows, then report the step done.
  useEffect(() => {
    const active = stepKey ? stepKey.split(',').map(Number) : [];
    if (!active.length) return;
    if (!animate || reducedMotion()) return;
    let raf = 0;
    let pause: ReturnType<typeof setTimeout> | undefined;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / STEP_MS);
      for (const i of active) {
        const p = pointAt(paths[i] ?? [], t);
        packets.current[i]?.setAttribute('transform', `translate(${p.x - 3} ${p.y - 3})`);
      }
      if (t < 1) raf = requestAnimationFrame(tick);
      else pause = setTimeout(() => playRef.current?.onDone(), 350);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(pause);
    };
  }, [stepKey, animate, paths]);

  const slotAt = (s: Slot): Pt => {
    if (s.kind === 'group') {
      const g = d.groups.find((x) => x.id === s.id)!;
      const r = groupRect(d, g);
      return { x: r.tab.x + r.tab.w / 2, y: r.tab.y + r.tab.h / 2 };
    }
    return nodeCenter(d, byId.get(s.id)!);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, from: string) => {
    if (e.key.startsWith('Arrow')) {
      const next = nextSlot(slots.map((s) => ({ id: s.id, at: slotAt(s) })), from, e.key as ArrowKey);
      if (next) {
        e.preventDefault();
        btns.current.get(next.id)?.focus();
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && placements[from]) {
      e.preventDefault();
      onRemove(from);
    }
  };
  const firstSlot = slots.find((s) => !placements[s.id])?.id ?? slots[0]?.id;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="diagram" style={{ aspectRatio: `${w} / ${h}`, minWidth: `${d.cols * 62}px` }}>
      <svg viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" role="img" aria-label={`Architecture diagram: ${puzzle.title}`}>
        {d.groups.map((g) => (
          <Group key={g.id} d={d} g={g} filled={g.service ? placements[g.id] : undefined} />
        ))}
        {edges.map((e, i) => {
          const pts = paths[i];
          if (!pts.length) return null;
          const lit = play?.lit.has(i) || play?.active.includes(i);
          const color = serviceColor(byId.get(e.from)?.service ?? placements[e.from] ?? byId.get(e.to)?.service);
          const mid = badgeAt(pts);
          return (
            <g key={`${e.from}-${e.to}-${i}`} className={`edge-line ${e.step ? '' : 'control'} ${lit ? 'lit' : ''}`} style={{ color }}>
              <path d={pathD(pts)} fill="none" strokeDasharray={e.step && !e.dashed ? undefined : '4 3'} />
              <polygon points={arrowHead(pts)} />
              {e.twoWay && <polygon points={arrowHead([...pts].reverse())} />}
              {e.step && (
                <g className="edge-step" transform={`translate(${mid.x - 6} ${mid.y - 6})`}>
                  <rect width="12" height="12" />
                  <text x="6" y="9" textAnchor="middle">
                    {stepLabel ? stepLabel(e.step) : e.step}
                  </text>
                </g>
              )}
              <text className="edge-label" x={mid.x} y={mid.y - 9} textAnchor="middle">
                {e.label}
              </text>
              {play?.active.includes(i) && play.animate && !reducedMotion() && (
                <rect
                  ref={(el) => {
                    packets.current[i] = el;
                  }}
                  className="packet"
                  width="6"
                  height="6"
                  transform={`translate(${pts[0].x - 3} ${pts[0].y - 3})`}
                />
              )}
            </g>
          );
        })}
        {d.nodes.map((n) => (
          <Node key={n.id} d={d} n={n} placements={placements} required={!!n.service && puzzle.required.includes(n.service)} />
        ))}
      </svg>
      {/* The slots are real buttons over the drawing: focus, hit-testing and screen readers all use them. */}
      <div className="slot-layer" role="group" aria-label="Diagram spots. Arrow keys move between spots.">
        {slots.map((s) => {
          const at = slotAt(s);
          const size = s.kind === 'badge' ? BADGE : s.kind === 'group' ? 14 : BOX;
          const wide = s.kind === 'group' ? groupRect(d, d.groups.find((g) => g.id === s.id)!).tab.w : size;
          const filled = placements[s.id];
          const state = filled ? `has ${slotName(puzzle, s.id, filled)}. Enter to pick it up, Delete to clear.` : armed ? `empty. Enter to place ${slotName(puzzle, s.id, armed)}.` : 'empty.';
          return (
            <button
              key={s.id}
              ref={(el) => {
                if (el) btns.current.set(s.id, el);
                else btns.current.delete(s.id);
                slotRef(s.id, el);
              }}
              className={`slot ${s.kind} ${filled ? 'filled' : 'empty'} ${s.required ? 'req' : 'opt'} ${hinted === s.id ? 'hinted' : ''} ${rejected === s.id ? 'rejected' : ''} ${dragOver === s.id ? 'over' : ''} ${armed && !filled ? 'target' : ''}`}
              style={{ left: pct(at.x - wide / 2, w), top: pct(at.y - size / 2, h), width: pct(wide, w), height: pct(size, h) }}
              tabIndex={s.id === firstSlot ? 0 : -1}
              aria-label={`${s.role}${s.required ? '' : ' (bonus)'}: ${state}`}
              data-slot={s.id}
              onClick={() => onSlot(s.id)}
              onKeyDown={(e) => onKey(e, s.id)}
            />
          );
        })}
      </div>
      <ol className="sr-only">
        {edges
          .filter((e) => e.step)
          .map((e, i) => (
            <li key={i}>
              {labelOf(puzzle, byId.get(e.from), placements)} to {labelOf(puzzle, byId.get(e.to), placements)}: {e.caption ?? e.label}
            </li>
          ))}
      </ol>
    </div>
  );
}

const labelOf = (p: Puzzle, n: DiagramNode | undefined, placements: Placements) =>
  n ? (placements[n.id] ? slotName(p, n.id, placements[n.id]) : n.fixed ? (productName(n.fixed) ?? n.role) : n.role) : '';

function Group({ d, g, filled }: { d: Puzzle['diagram'] & object; g: DiagramGroup; filled?: string }) {
  const r = groupRect(d, g);
  const color = GROUP_COLOR[g.kind];
  const icon = groupIconPath(g.kind);
  return (
    <g className={`dgroup ${g.kind} ${g.service ? (filled ? 'slot-filled' : 'slot-empty') : ''}`}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={DASHED.has(g.kind) ? '5 3' : undefined} />
      <rect x={r.tab.x} y={r.tab.y} width={r.tab.w} height={r.tab.h} fill={g.service && !filled ? 'none' : color} stroke={color} strokeDasharray={g.service && !filled ? '3 2' : undefined} />
      {icon && <image href={icon} x={r.tab.x} y={r.tab.y} width={r.tab.h} height={r.tab.h} />}
      <text className="dgroup-label" x={r.tab.x + (icon ? r.tab.h + 3 : 4)} y={r.tab.y + 9.5} fill={g.service && !filled ? color : '#15171b'}>
        {cityLabel(g.label)}
      </text>
    </g>
  );
}

function Node({ d, n, placements, required }: { d: Puzzle['diagram'] & object; n: DiagramNode; placements: Placements; required: boolean }) {
  const c = nodeCenter(d, n);
  const size = n.attachTo ? BADGE : BOX;
  const x = c.x - size / 2;
  const y = c.y - size / 2;
  const svc = n.service ? placements[n.id] : n.mirrorOf ? placements[n.mirrorOf] : undefined;
  const lines = twoLines(n.role);
  const caption = !n.attachTo && (
    <text className="node-label" x={c.x} y={c.y + size / 2 + 9} textAnchor="middle">
      {lines.map((l, i) => (
        <tspan key={i} x={c.x} dy={i ? 9 : 0}>
          {l}
        </tspan>
      ))}
    </text>
  );
  if (n.actor) {
    const icon = actorIconPath(n.actor);
    return (
      <g className="dnode actor">
        {icon ? <image href={icon} x={c.x - 16} y={c.y - 16} width="32" height="32" /> : <rect className="actor-fallback" x={c.x - 12} y={c.y - 12} width="24" height="24" />}
        {caption}
      </g>
    );
  }
  if (n.fixed) {
    const icon = productIconPath(n.fixed);
    return (
      <g className="dnode fixed">
        <rect className="box" x={x} y={y} width={size} height={size} />
        {icon ? <image href={icon} x={x + 5} y={y + 5} width={size - 10} height={size - 10} /> : <rect className="actor-fallback" x={x + 10} y={y + 10} width={size - 20} height={size - 20} />}
        <title>{productName(n.fixed)}</title>
        {caption}
      </g>
    );
  }
  if (n.mirrorOf) {
    const shown = isFilled(d, placements, n.id);
    return (
      <g className={`dnode mirror ${shown ? 'shown' : ''}`}>
        <rect x={x} y={y} width={size} height={size} fill="none" />
        {shown && svc && <ServiceGlyph id={svc} product={d.nodes.find((m) => m.id === n.mirrorOf)?.shows} x={x} y={y} size={size} />}
        {caption}
      </g>
    );
  }
  return (
    <g className={`dnode ${svc ? 'filled' : 'empty'} ${required ? 'req' : 'opt'} ${n.side ? 'side' : ''}`} style={{ color: serviceColor(svc) }}>
      <rect className="box" x={x} y={y} width={size} height={size} />
      {svc ? (
        <ServiceGlyph id={svc} product={n.shows} x={x} y={y} size={size} />
      ) : (
        <text className="box-mark" x={c.x} y={c.y + 4} textAnchor="middle">
          {required ? '?' : '+'}
        </text>
      )}
      {caption}
    </g>
  );
}

function ServiceGlyph({ id, product, x, y, size }: { id: string; product?: string; x: number; y: number; size: number }) {
  const icon = (product && productIconPath(product)) || iconPath(id);
  const pad = Math.round(size * 0.12);
  if (icon) return <image href={icon} x={x + pad} y={y + pad} width={size - pad * 2} height={size - pad * 2} />;
  return (
    <>
      <rect x={x + pad} y={y + pad} width={size - pad * 2} height={size - pad * 2} fill={serviceColor(id)} />
      <text className="glyph-text" x={x + size / 2} y={y + size / 2 + 3} textAnchor="middle">
        {shortName(id).slice(0, 3)}
      </text>
    </>
  );
}
