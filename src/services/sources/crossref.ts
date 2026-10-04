/**
 * Crossref REST API — https://api.crossref.org (public, no key).
 *
 * Used twice:
 *  - by the pipeline (`CrossrefSource`) for the daily catalogue, and
 *  - by the browser (`searchWorks`, `lookupDoi`, `searchJournals`) for
 *    user-initiated lookups such as adding an example paper by DOI.
 * Supplying a contact email routes requests to Crossref's "polite pool".
 */
import type { DocumentType, JournalInfo, Paper } from '../../types/paper';
import { getJson, RateLimiter, type RequestOptions } from '../http';
import {
  cleanAbstract, cleanDoi, cleanIssn, cleanText, compact, fixAllCaps, isoDate, makeAuthor, makePaperId,
} from '../../utils/normalize';
import type { FetchRequest, FetchResult, Logger, PaperSource } from './types';

const BASE = 'https://api.crossref.org';

const SELECT = [
  'DOI', 'title', 'author', 'container-title', 'ISSN', 'publisher', 'volume', 'issue', 'page',
  'article-number', 'published', 'published-online', 'created', 'abstract', 'type', 'URL',
  'is-referenced-by-count', 'link', 'license',
].join(',');

type DateParts = { 'date-parts'?: (number | null)[][]; 'date-time'?: string };

export interface CrossrefWork {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string; ORCID?: string; affiliation?: { name?: string }[] }[];
  'container-title'?: string[];
  ISSN?: string[];
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  'article-number'?: string;
  published?: DateParts;
  'published-online'?: DateParts;
  created?: DateParts;
  abstract?: string;
  type?: string;
  subtype?: string;
  URL?: string;
  'is-referenced-by-count'?: number;
  link?: { URL?: string; 'content-type'?: string }[];
  license?: { URL?: string }[];
}

interface WorksResponse {
  message: { items: CrossrefWork[]; 'next-cursor'?: string; 'total-results'?: number };
}

const TYPE_MAP: Record<string, DocumentType> = {
  'journal-article': 'article',
  'proceedings-article': 'conference',
  'posted-content': 'preprint',
  'book-chapter': 'book-chapter',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  dataset: 'dataset',
};

/** Table-of-contents noise that Crossref registers as journal articles. */
const JUNK_TITLE =
  /^(front ?matter|back ?matter|editorial board|issue information|table of contents|contents|cover( image| picture)?|masthead|index|title page|(outside |inside )?(front|back) cover|graphical abstract toc|calendar|announcements?|corrigendum\b.*|erratum\b.*|correction( to)?\b.*|retraction\b.*|publisher'?s? note\b.*)$/i;

function resolveDate(work: CrossrefWork): string | undefined {
  const parts =
    work['published-online']?.['date-parts']?.[0] ??
    work.published?.['date-parts']?.[0] ??
    work.created?.['date-parts']?.[0];
  if (!parts?.[0]) return undefined;
  const date = isoDate(parts[0], parts[1] ?? undefined, parts[2] ?? undefined);
  const created = work.created?.['date-time']?.slice(0, 10);
  if (!date || !created) return date;
  // Many publishers register only year or year-month. When the DOI was created
  // in that same period, the registration date is a good day-precision estimate.
  if (date.length < 10 && created.startsWith(date)) return created;
  // Journals often register the cover date of a future issue ("2027-01") for
  // articles that are already online. The DOI registration date is when the
  // paper actually became available, which is what a "new papers" feed needs.
  if (date.slice(0, created.length) > created) return created;
  return date;
}

export function normalizeCrossrefWork(work: CrossrefWork): Paper | undefined {
  const doi = cleanDoi(work.DOI);
  const title = fixAllCaps(cleanText(work.title?.[0]));
  if (!doi || !title || JUNK_TITLE.test(title)) return undefined;

  const publicationDate = resolveDate(work);
  const openAccess = work.license?.some((l) => /creativecommons\.org/i.test(l.URL ?? '')) || undefined;
  const pdf = work.link?.find((l) => l['content-type'] === 'application/pdf')?.URL;
  const issn = [...new Set((work.ISSN ?? []).map(cleanIssn).filter((x): x is string => !!x))];

  const paper: Paper = {
    id: '',
    title,
    abstract: cleanAbstract(work.abstract),
    authors: (work.author ?? [])
      .map((a) =>
        a.family || a.given
          ? makeAuthor(a.given, a.family, {
              ...(a.ORCID && { orcid: a.ORCID.replace(/^https?:\/\/orcid\.org\//, '') }),
              ...(a.affiliation?.[0]?.name && { affiliation: cleanText(a.affiliation[0].name) }),
            })
          : { name: cleanText(a.name) },
      )
      .filter((a) => a.name),
    journal: fixAllCaps(cleanText(work['container-title']?.[0])) || undefined,
    issn,
    publisher: cleanText(work.publisher) || undefined,
    volume: work.volume,
    issue: work.issue,
    pages: work.page ?? work['article-number'],
    documentType: TYPE_MAP[work.type ?? ''] ?? 'other',
    publicationDate,
    year: publicationDate ? Number(publicationDate.slice(0, 4)) : undefined,
    doi,
    url: `https://doi.org/${doi}`,
    pdfUrl: openAccess ? pdf : undefined,
    openAccess,
    citationCount: work['is-referenced-by-count'],
    sources: ['crossref'],
  };
  paper.id = makePaperId(paper);
  return compact(paper);
}

function buildUrl(path: string, params: Record<string, string | number | undefined>, mailto?: string): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  if (mailto) qs.set('mailto', mailto);
  return `${BASE}${path}?${qs}`;
}

// ---------------------------------------------------------------------------
// Browser-safe, user-initiated lookups
// ---------------------------------------------------------------------------

const browserLimiter = new RateLimiter(350);
const browserOptions: RequestOptions = { limiter: browserLimiter, attempts: 2, timeoutMs: 20_000 };

export interface WorkSearchOptions {
  rows?: number;
  fromDate?: string;
  issn?: string;
  sort?: 'relevance' | 'published';
}

/** Free-text search across titles, authors, journals and years. */
export async function searchWorks(query: string, options: WorkSearchOptions = {}): Promise<Paper[]> {
  const filters = [options.fromDate && `from-pub-date:${options.fromDate}`, options.issn && `issn:${options.issn}`]
    .filter(Boolean)
    .join(',');
  const url = buildUrl('/works', {
    'query.bibliographic': query || undefined,
    filter: filters || undefined,
    rows: options.rows ?? 20,
    sort: options.sort ?? 'relevance',
    order: 'desc',
    select: SELECT,
  });
  const data = await getJson<WorksResponse>(url, browserOptions);
  return data.message.items.map(normalizeCrossrefWork).filter((p): p is Paper => !!p);
}

export async function lookupDoi(doi: string): Promise<Paper | undefined> {
  const clean = cleanDoi(doi);
  if (!clean) return undefined;
  const data = await getJson<{ message: CrossrefWork }>(`${BASE}/works/${encodeURIComponent(clean)}`, browserOptions);
  return normalizeCrossrefWork(data.message);
}

/** Journal title search — lets users follow any journal Crossref knows, not just catalogued ones. */
export async function searchJournals(query: string, rows = 12): Promise<JournalInfo[]> {
  const data = await getJson<{ message: { items: { title?: string; ISSN?: string[]; publisher?: string }[] } }>(
    buildUrl('/journals', { query, rows }),
    browserOptions,
  );
  return data.message.items
    .filter((j) => j.title)
    .map((j) => ({
      name: cleanText(j.title),
      issn: (j.ISSN ?? []).map(cleanIssn).filter((x): x is string => !!x),
      publisher: j.publisher,
      paperCount: 0,
    }));
}

// ---------------------------------------------------------------------------
// Pipeline source
// ---------------------------------------------------------------------------

export interface CrossrefConfig {
  mailto?: string;
}

export class CrossrefSource implements PaperSource {
  readonly id = 'crossref' as const;
  /** Crossref asks for ≤ ~5 req/s in the polite pool; stay well below. */
  private readonly limiter: RateLimiter;
  private requests = 0;

  constructor(private readonly config: CrossrefConfig = {}) {
    this.limiter = new RateLimiter(config.mailto ? 300 : 1000);
  }

  isConfigured(): boolean {
    return true;
  }

  private async page(url: string, log: Logger): Promise<WorksResponse['message']> {
    this.requests++;
    const data = await getJson<WorksResponse>(url, {
      limiter: this.limiter,
      headers: {
        'User-Agent': `PaperScout/0.1 (https://github.com/; ${this.config.mailto ? `mailto:${this.config.mailto}` : 'no-contact'})`,
      },
      onRetry: ({ attempt, waitMs, reason }) =>
        log.warn(`crossref: retry ${attempt} in ${Math.round(waitMs / 1000)}s (${reason.slice(0, 120)})`),
    });
    return data.message;
  }

  async fetchRecent(req: FetchRequest, log: Logger): Promise<FetchResult> {
    this.requests = 0;
    const papers: Paper[] = [];
    const warnings: string[] = [];
    const collect = (items: CrossrefWork[]) => {
      let n = 0;
      for (const item of items) {
        const paper = normalizeCrossrefWork(item);
        if (paper) (papers.push(paper), n++);
      }
      return n;
    };

    // 1) Everything recent from each tracked journal (cursor pagination).
    const journalCap = req.maxPerQuery * 4;
    for (const journal of req.journals) {
      const issn = journal.issn?.[0];
      if (!issn) {
        warnings.push(`crossref: journal "${journal.name}" has no ISSN — skipped`);
        continue;
      }
      try {
        let cursor: string | undefined = '*';
        let got = 0;
        while (cursor && got < journalCap) {
          const rows = Math.min(200, journalCap - got);
          const message = await this.page(
            buildUrl(`/journals/${issn}/works`, {
              // No `sort`: Crossref does not allow date sorting with deep-paging cursors.
              filter: `from-pub-date:${req.fromDate}`,
              rows, cursor, select: SELECT,
            }, this.config.mailto),
            log,
          );
          got += message.items.length;
          collect(message.items);
          cursor = message.items.length === rows ? message['next-cursor'] : undefined;
        }
        log.info(`crossref: journal "${journal.name}" → ${got} records`);
      } catch (error) {
        const msg = `crossref: journal "${journal.name}" failed — ${(error as Error).message}`;
        warnings.push(msg);
        log.warn(msg);
      }
    }

    // 2) Most relevant recent works per topic, across all journals.
    for (const topic of req.topics) {
      try {
        const message = await this.page(
          buildUrl('/works', {
            'query.bibliographic': topic,
            filter: `from-pub-date:${req.fromDate}`,
            sort: 'relevance', order: 'desc', rows: Math.min(req.maxPerQuery, 200), select: SELECT,
          }, this.config.mailto),
          log,
        );
        log.info(`crossref: topic "${topic}" → ${collect(message.items)} records`);
      } catch (error) {
        const msg = `crossref: topic "${topic}" failed — ${(error as Error).message}`;
        warnings.push(msg);
        log.warn(msg);
      }
    }

    return { papers, requests: this.requests, warnings };
  }
}
