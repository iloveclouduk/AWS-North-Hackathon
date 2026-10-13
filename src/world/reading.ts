// "Learn more": free, public reading from AWS's learning partners for each service (shared/further-reading.json).
// Links only: the extension never fetches them, and our own cards stay in our words with AWS docs as the source.
import readingJson from '../../shared/further-reading.json' with { type: 'json' };

export type PartnerId = 'tutorialsdojo' | 'awsfundamentals' | 'oreilly';

export interface Partner {
  name: string;
  kind: string;
  home: string;
  free: boolean;
}

export interface Book {
  id: string;
  title: string;
  authors: string;
  publisher: string;
  year?: number;
  isbn?: string;
  url: string;
  free: boolean;
  freeSample?: boolean;
  services: string[];
}

export interface ReadingLink {
  partner: PartnerId;
  /** What the player reads on the button, e.g. "Cheat sheet"; the partner is named under it. */
  label: string;
  url: string;
  free: boolean;
  /** For a book: who wrote it. */
  by?: string;
}

const data = readingJson as unknown as {
  partners: Record<PartnerId, Partner>;
  books: Book[];
  services: Record<string, { cheatSheet?: string; articles?: string }>;
};

export const PARTNERS = data.partners;
export const BOOKS = data.books;
export const READING = data.services;

/** The only hosts a reading link may open: the partners' own sites, over https. */
export const READING_HOSTS = ['tutorialsdojo.com', 'awsfundamentals.com', 'www.oreilly.com'] as const;

export const isReadingUrl = (raw: string) => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && (READING_HOSTS as readonly string[]).includes(u.hostname);
  } catch {
    return false;
  }
};

/** A service's shelf: free reading first (cheat sheet, articles), then books that cover it. */
export function readingFor(serviceId: string): ReadingLink[] {
  const s = READING[serviceId] ?? {};
  const out: ReadingLink[] = [];
  if (s.cheatSheet) out.push({ partner: 'tutorialsdojo', label: 'Cheat sheet', url: s.cheatSheet, free: true });
  if (s.articles) out.push({ partner: 'awsfundamentals', label: 'Articles', url: s.articles, free: true });
  for (const b of BOOKS.filter((b) => b.services.includes(serviceId))) {
    out.push({ partner: b.publisher === "O'Reilly" ? 'oreilly' : 'awsfundamentals', label: `${b.title} (book)`, url: b.url, free: b.free, by: b.authors });
  }
  return out;
}
