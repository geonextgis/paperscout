/**
 * Semantic Scholar Academic Graph API — https://api.semanticscholar.org/api-docs/graph
 *
 * Works without a key (shared, heavily throttled pool); an API key gives a
 * dedicated 1 request/second allowance. Besides topic search, this source
 * *enriches* records from other databases with abstracts, citation counts and
 * open-access PDFs via the batch endpoint.
 */
import type { DocumentType, Paper } from '../../types/paper';
import { getJson, RateLimiter } from '../http';
import { cleanAbstract, cleanDoi, cleanIssn, cleanText, compact, makePaperId, parseAuthorName } from '../../utils/normalize';
import type { FetchRequest, FetchResult, Logger, PaperSource } from './types';

const BASE = 'https://api.semanticscholar.org/graph/v1';

const FIELDS = [
  'title', 'abstract', 'authors', 'venue', 'publicationVenue', 'journal', 'publicationDate', 'year',
  'externalIds', 'openAccessPdf', 'isOpenAccess', 'citationCount', 'fieldsOfStudy', 'publicationTypes', 'url',
].join(',');

export interface S2Paper {
  paperId?: string;
  title?: string;
  abstract?: string | null;
  authors?: { name?: string }[];
  venue?: string;
  publicationVenue?: { name?: string; issn?: string; alternate_issns?: string[] } | null;
  journal?: { name?: string; volume?: string; pages?: string } | null;
  publicationDate?: string | null;
  year?: number | null;
  externalIds?: { DOI?: string; ArXiv?: string } | null;
  openAccessPdf?: { url?: string } | null;
  isOpenAccess?: boolean;
  citationCount?: number;
  fieldsOfStudy?: string[] | null;
  publicationTypes?: string[] | null;
  url?: string;
}

function documentType(types: string[] | null | undefined, isArxiv: boolean): DocumentType {
  if (types?.includes('Review')) return 'review';
  if (types?.includes('JournalArticle')) return 'article';
  if (types?.includes('Conference')) return 'conference';
  if (types?.includes('Book')) return 'book';
  if (types?.includes('BookSection')) return 'book-chapter';
  if (types?.includes('Dataset')) return 'dataset';
  if (types?.includes('Editorial')) return 'editorial';
  return isArxiv ? 'preprint' : 'other';
}

export function normalizeS2Paper(raw: S2Paper): Paper | undefined {
  const title = cleanText(raw.title);
  if (!raw.paperId || !title) return undefined;
  const doi = cleanDoi(raw.externalIds?.DOI);
  const arxivId = raw.externalIds?.ArXiv;
  const journal = cleanText(raw.journal?.name || raw.publicationVenue?.name || raw.venue) || undefined;
  const isArxivOnly = !!arxivId && (!journal || /arxiv/i.test(journal));
  const pdfUrl = raw.openAccessPdf?.url || undefined;
  const year = raw.year ?? (raw.publicationDate ? Number(raw.publicationDate.slice(0, 4)) : undefined);

  const paper: Paper = {
    id: '',
    title,
    abstract: cleanAbstract(raw.abstract),
    authors: (raw.authors ?? []).filter((a) => a.name).map((a) => parseAuthorName(a.name!)),
    journal: isArxivOnly ? 'arXiv' : journal,
    issn: [raw.publicationVenue?.issn, ...(raw.publicationVenue?.alternate_issns ?? [])]
      .map(cleanIssn)
      .filter((x): x is string => !!x),
    volume: raw.journal?.volume?.trim() || undefined,
    pages: raw.journal?.pages?.replace(/\s+/g, '') || undefined,
    documentType: documentType(raw.publicationTypes, isArxivOnly),
    publicationDate: raw.publicationDate ?? (year ? String(year) : undefined),
    year: year ?? undefined,
    doi,
    url: doi ? `https://doi.org/${doi}` : raw.url,
    pdfUrl,
    openAccess: raw.isOpenAccess || !!pdfUrl || undefined,
    citationCount: raw.citationCount,
    fieldsOfStudy: raw.fieldsOfStudy ?? undefined,
    sources: ['semanticscholar'],
    semanticScholarId: raw.paperId,
    arxivId,
  };
  paper.id = makePaperId(paper);
  return compact(paper);
}

export interface SemanticScholarConfig {
  apiKey?: string;
}

export class SemanticScholarSource implements PaperSource {
  readonly id = 'semanticscholar' as const;
  private readonly limiter: RateLimiter;
  private requests = 0;

  constructor(private readonly config: SemanticScholarConfig = {}) {
    this.limiter = new RateLimiter(config.apiKey ? 1100 : 3500);
  }

  isConfigured(): boolean {
    return true; // key is optional
  }

  private options(log: Logger) {
    return {
      limiter: this.limiter,
      attempts: 5,
      backoffMs: this.config.apiKey ? 2000 : 6000,
      headers: this.config.apiKey ? { 'x-api-key': this.config.apiKey } : undefined,
      onRetry: ({ attempt, waitMs, reason }: { attempt: number; waitMs: number; reason: string }) =>
        log.warn(`semanticscholar: retry ${attempt} in ${Math.round(waitMs / 1000)}s (${reason.slice(0, 100)})`),
    };
  }

  async fetchRecent(req: FetchRequest, log: Logger): Promise<FetchResult> {
    this.requests = 0;
    const papers: Paper[] = [];
    const warnings: string[] = [];

    for (const topic of req.topics) {
      try {
        let token: string | undefined;
        let got = 0;
        do {
          const qs = new URLSearchParams({
            query: topic,
            publicationDateOrYear: `${req.fromDate}:`,
            fields: FIELDS,
            sort: 'publicationDate:desc',
          });
          if (token) qs.set('token', token);
          this.requests++;
          const data = await getJson<{ data?: S2Paper[]; token?: string | null }>(
            `${BASE}/paper/search/bulk?${qs}`,
            this.options(log),
          );
          for (const raw of data.data ?? []) {
            if (got >= req.maxPerQuery) break;
            const paper = normalizeS2Paper(raw);
            if (paper) (papers.push(paper), got++);
          }
          token = got < req.maxPerQuery ? (data.token ?? undefined) : undefined;
        } while (token);
        log.info(`semanticscholar: topic "${topic}" → ${got} records`);
      } catch (error) {
        const msg = `semanticscholar: topic "${topic}" failed — ${(error as Error).message}`;
        warnings.push(msg);
        log.warn(msg);
      }
    }
    return { papers, requests: this.requests, warnings };
  }

  /**
   * Look up papers by DOI in batches of 500 and return Semantic Scholar's view
   * of them. The caller merges the result through the normal deduplication, so
   * missing abstracts / citation counts / PDFs get filled in.
   */
  async enrich(dois: string[], log: Logger): Promise<FetchResult> {
    const papers: Paper[] = [];
    const warnings: string[] = [];
    let requests = 0;
    for (let i = 0; i < dois.length; i += 500) {
      const batch = dois.slice(i, i + 500);
      try {
        requests++;
        const data = await getJson<(S2Paper | null)[]>(`${BASE}/paper/batch?fields=${FIELDS}`, {
          ...this.options(log),
          method: 'POST',
          body: { ids: batch.map((d) => `DOI:${d}`) },
          timeoutMs: 60_000,
        });
        data.forEach((raw, j) => {
          if (!raw) return;
          const paper = normalizeS2Paper(raw);
          // Pin the DOI we asked for so the merge is guaranteed to line up.
          if (paper) papers.push({ ...paper, doi: batch[j], id: `doi:${batch[j]}` });
        });
      } catch (error) {
        const msg = `semanticscholar: enrichment batch ${i / 500 + 1} failed — ${(error as Error).message}`;
        warnings.push(msg);
        log.warn(msg);
      }
    }
    log.info(`semanticscholar: enriched ${papers.length}/${dois.length} records`);
    return { papers, requests, warnings };
  }
}
