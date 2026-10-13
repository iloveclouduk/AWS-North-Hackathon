import { openReading } from '@/app/runtime';
import { PARTNERS, readingFor } from '@/world/reading';
import { feel } from './feedback';

/** "Learn more": the partners' free reading for this service, then books that cover it, each credited and linked. */
export function ReadingShelf({ serviceId }: { serviceId: string }) {
  const links = readingFor(serviceId);
  if (!links.length) return null;
  return (
    <section className="place-reading" aria-label="Learn more">
      <h4 className="label">Learn more</h4>
      <ul className="reading-list">
        {links.map((l) => (
          <li key={l.url}>
            <button
              className="btn tiny ghost reading-link"
              onClick={() => {
                feel.tap();
                openReading(l.url);
              }}
            >
              <span className="reading-title">{l.label} ↗</span>
              <span className="muted reading-by">
                {l.by ? `${l.by} · ` : ''}
                {PARTNERS[l.partner].name}
                {l.free ? ' · free' : ''}
              </span>
              <span className="sr-only"> (opens in a new tab)</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted reading-note">From AWS’s learning partners. Our cards use our own words and cite AWS docs.</p>
    </section>
  );
}
