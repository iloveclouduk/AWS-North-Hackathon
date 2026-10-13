import { useRef, useState, type KeyboardEvent } from 'react';
import { useCity } from '@/state/store';
import { REGIONS, WORLD_MAP, type Region } from '@/world/culture';
import { partitionName, regionFacts, separatePartition } from '@/world/regions';

const CELL = 3;

/** The land never changes: one path for every land cell (one DOM node instead of ~1,400 rects). */
const LAND_PATH = WORLD_MAP.mask
  .flatMap((row, y) => [...row].map((ch, x) => (ch === '#' ? `M${x * CELL} ${y * CELL}h${CELL - 1}v${CELL - 1}h${1 - CELL}z` : '')))
  .join('');

/** Regions west → east, for arrow-key navigation. */
const BY_LON = [...REGIONS.regions].sort((a, b) => a.lon - b.lon);

/** Pixel world map of the real AWS Regions (shared/regions.json); this city's Region is highlighted. Pick one to visit its city. */
export function RegionMap() {
  const cityRegion = useCity((s) => s.cityRegion);
  const enterRegion = useCity((s) => s.enterRegion);
  const CITY_REGION = REGIONS.regions.find((r) => r.code === cityRegion);
  const [hover, setHover] = useState<Region | undefined>(CITY_REGION);
  const dots = useRef(new Map<string, SVGGElement>());
  // One tab stop for the whole map; arrow keys move between Regions (roving tabindex).
  const focused = hover ?? CITY_REGION ?? BY_LON[0];
  const onKey = (e: KeyboardEvent) => {
    const i = BY_LON.findIndex((r) => r.code === focused?.code);
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? BY_LON[(i + 1) % BY_LON.length] : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? BY_LON[(i - 1 + BY_LON.length) % BY_LON.length] : undefined;
    if (!next) return;
    e.preventDefault();
    setHover(next);
    dots.current.get(next.code)?.focus();
  };
  const m = WORLD_MAP;
  const w = m.cols * CELL;
  const h = m.rows * CELL;
  const xy = (r: Region) => ({
    x: ((r.lon - m.lonMin) / (m.lonMax - m.lonMin)) * w,
    y: ((m.latMax - r.lat) / (m.latMax - m.latMin)) * h,
  });
  return (
    <section className="region-map" aria-label="AWS Regions world map">
      <h4>
        AWS Regions <span className="muted">· {REGIONS.regions.length} Regions · as of {REGIONS.asOf}</span>
      </h4>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`World map with ${REGIONS.regions.length} AWS Regions; this city is ${CITY_REGION?.name ?? cityRegion}`} shapeRendering="crispEdges">
        <path d={LAND_PATH} className="land" />
        {REGIONS.regions.map((r) => {
          const p = xy(r);
          const here = r.code === cityRegion;
          return (
            <g
              key={r.code}
              ref={(el) => void (el ? dots.current.set(r.code, el) : dots.current.delete(r.code))}
              className={`rg ${here ? 'here' : ''} ${hover?.code === r.code ? 'hover' : ''}`}
              onMouseEnter={() => setHover(r)}
              onClick={() => enterRegion(r.code)}
              onFocus={() => setHover(r)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' ? (e.preventDefault(), enterRegion(r.code)) : onKey(e))}
              tabIndex={focused?.code === r.code ? 0 : -1}
              role="button"
              aria-label={`${r.name} (${r.code}). Enter visits its city.`}
            >
              {here && <rect x={p.x - 5} y={p.y - 5} width={10} height={10} className="halo" />}
              <rect x={Math.round(p.x) - 2} y={Math.round(p.y) - 2} width={4} height={4} />
            </g>
          );
        })}
      </svg>
      <div className="region-info" aria-live="polite">
        {hover ? (
          <>
            <b>{hover.name}</b> <code>{hover.code}</code>
            <span className="muted">
              {regionFacts(hover.code)?.azIds.length ? ` · ${regionFacts(hover.code)!.azIds.length} AZs` : ''}
              {separatePartition(hover.code) ? ` · ${partitionName(hover.code)}` : regionFacts(hover.code)?.optIn ? ' · opt-in' : ''}
            </span>
            {hover.code === cityRegion ? <span className="here-tag"> ← you are here</span> : <span className="muted"> · tap to visit its city</span>}
          </>
        ) : (
          <span className="muted">Point at a dot to see the Region</span>
        )}
      </div>
      <div className="muted small">
        <a href={REGIONS.docs ?? REGIONS.source} target="_blank" rel="noreferrer" title={`Map: ${m.source.split(',')[0]}`}>
          Sources ↗
        </a>
      </div>
    </section>
  );
}
