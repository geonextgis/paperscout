/**
 * Source-independent cleaning helpers. Used by the pipeline (Node) and by the
 * browser's on-demand Crossref lookups, so nothing here may touch Node or DOM APIs.
 */
import type { Author, Paper } from '../types/paper';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', deg: '°', times: '×', minus: '−',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Strip markup (HTML / JATS / MathML wrappers), decode entities, collapse whitespace. */
export function cleanText(text: string | undefined | null): string {
  if (!text) return '';
  return decodeEntities(String(text).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanAbstract(text: string | undefined | null): string | undefined {
  const cleaned = cleanText(text).replace(/^(abstract|summary)\s*[:.]?\s*/i, '');
  return cleaned.length >= 40 ? cleaned : undefined;
}

/** `https://doi.org/10.1000/ABC` → `10.1000/abc`. Returns undefined when not a DOI. */
export function cleanDoi(doi: string | undefined | null): string | undefined {
  if (!doi) return undefined;
  const d = String(doi)
    .trim()
    .replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : undefined;
}

export function stripDiacritics(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Aggressive key for fuzzy title equality: lower-case alphanumerics only. */
export function titleKey(title: string): string {
  return stripDiacritics(title).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Key for journal-name equality ("Remote Sensing of Environment" ≡ "REMOTE SENSING OF ENVIRONMENT"). */
export function journalKey(name: string | undefined): string {
  if (!name) return '';
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function cleanIssn(issn: string | undefined | null): string | undefined {
  if (!issn) return undefined;
  const raw = issn.toUpperCase().replace(/[^0-9X]/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : undefined;
}

/** WoS returns titles and journals in ALL CAPS for some records — make them readable. */
export function fixAllCaps(text: string): string {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6 || letters !== letters.toUpperCase()) return text;
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return text
    .toLowerCase()
    .split(' ')
    .map((word, i) => (i > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Build a (possibly partial) ISO date from loose parts. */
export function isoDate(year?: number | string, month?: number | string, day?: number | string): string | undefined {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1500 || y > 2200) return undefined;
  let m: number | undefined;
  if (typeof month === 'string' && /[a-z]/i.test(month)) {
    // "OCT", "OCT 15", "SEP-OCT" → first month name found
    const idx = MONTHS.indexOf(month.trim().slice(0, 3).toLowerCase());
    m = idx >= 0 ? idx + 1 : undefined;
    const dayMatch = month.match(/\b(\d{1,2})\b/);
    if (dayMatch && day === undefined) day = dayMatch[1];
  } else if (month !== undefined && month !== '') {
    m = Number(month);
  }
  if (!m || !Number.isInteger(m) || m < 1 || m > 12) return String(y);
  const d = Number(day);
  const mm = String(m).padStart(2, '0');
  if (!day || !Number.isInteger(d) || d < 1 || d > 31) return `${y}-${mm}`;
  return `${y}-${mm}-${String(d).padStart(2, '0')}`;
}

/** Partial ISO date → timestamp (missing month/day resolve to the start of the period). */
export function dateToTime(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const m = date.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return undefined;
  return Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1);
}

export function makeAuthor(given: string | undefined, family: string | undefined, extra: Partial<Author> = {}): Author {
  const g = cleanText(given);
  const f = cleanText(family);
  return { name: [g, f].filter(Boolean).join(' '), ...(g && { given: g }), ...(f && { family: f }), ...extra };
}

/** Parse a free-form name: "Family, Given" or "Given Middle Family". */
export function parseAuthorName(raw: string): Author {
  const name = cleanText(raw);
  if (name.includes(',')) {
    const [family, given] = name.split(',').map((s) => s.trim());
    return makeAuthor(given, family);
  }
  const parts = name.split(' ');
  if (parts.length === 1) return { name, family: name };
  // Keep lower-case particles ("van der", "de") with the family name.
  let i = parts.length - 1;
  while (i > 1 && /^(van|von|de|der|den|del|della|di|da|dos|du|la|le|ten|ter)$/.test(parts[i - 1])) i--;
  return makeAuthor(parts.slice(0, i).join(' '), parts.slice(i).join(' '));
}

/** FNV-1a, enough for stable ids of DOI-less records. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function makePaperId(p: Pick<Paper, 'doi' | 'arxivId' | 'webOfScienceId' | 'semanticScholarId' | 'title' | 'year'>): string {
  if (p.doi) return `doi:${p.doi}`;
  if (p.arxivId) return `arxiv:${p.arxivId}`;
  if (p.webOfScienceId) return `wos:${p.webOfScienceId.replace(/^WOS:/i, '')}`;
  if (p.semanticScholarId) return `s2:${p.semanticScholarId}`;
  return `title:${hash(titleKey(p.title) + (p.year ?? ''))}`;
}

/** Drop undefined / empty fields so the JSON catalogue stays compact. */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0 && k !== 'authors' && k !== 'sources') continue;
    out[k] = v;
  }
  return out as T;
}
