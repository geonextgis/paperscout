/**
 * Web of Science™ Starter API (official) —
 * https://developer.clarivate.com/apis/wos-starter
 *
 * SECURITY: this module must only ever run server-side (GitHub Actions or a
 * local pipeline run). The API key is injected by `scripts/fetch-papers.ts`
 * from the `WOS_API_KEY` secret; it is sent in the `X-ApiKey` header, never in
 * a URL, and never written to logs or generated data. The frontend does not
 * import this file.
 *
 * Plan limits (as documented by Clarivate at the time of writing):
 *   - Free trial plan:        50 requests/day,  1 request/second
 *   - Institutional member:   5,000 requests/day, 5 requests/second
 *   - Integration (partner):  20,000 requests/day
 * A page holds at most 50 records, so the request budget — not the result
 * count — is the scarce resource. The client spends it breadth-first across
 * queries and stops cleanly when it runs out.
 *
 * Licensing limitations of the Starter API, which we respect rather than work
 * around: no abstracts, no cited references, and times-cited counts only for
 * institutional plans. Abstracts are filled in from other sources during merge.
 */
import type { DocumentType, Paper } from '../../types/paper';
import { getJson, HttpError, RateLimiter } from '../http';
import {
  cleanDoi, cleanIssn, cleanText, compact, fixAllCaps, isoDate, makePaperId, parseAuthorName,
} from '../../utils/normalize';
import type { FetchRequest, FetchResult, JournalQuery, Logger, PaperSource } from './types';

const BASE = 'https://api.clarivate.com/apis/wos-starter/v1';
const PAGE_SIZE = 50; // API maximum

export interface WosDocument {
  uid: string;
  title?: string;
  types?: string[];
  sourceTypes?: string[];
  source?: {
    sourceTitle?: string;
    publishYear?: number;
    publishMonth?: string;
    volume?: string;
    issue?: string;
    articleNumber?: string;
    pages?: { range?: string; begin?: string; end?: string };
  };
  names?: { authors?: { displayName?: string; wosStandard?: string }[] };
  links?: { record?: string };
  citations?: { db?: string; count?: number }[];
  identifiers?: { doi?: string; issn?: string; eissn?: string };
  keywords?: { authorKeywords?: string[] };
}

interface WosResponse {
  metadata?: { total?: number; page?: number; limit?: number };
  hits?: WosDocument[];
}

function documentType(types: string[] = []): DocumentType {
  const t = types.join(' ').toLowerCase();
  if (t.includes('review')) return 'review';
  if (t.includes('proceeding') || t.includes('meeting')) return 'conference';
  if (t.includes('book chapter')) return 'book-chapter';
  if (t.includes('book')) return 'book';
  if (t.includes('data')) return 'dataset';
  if (t.includes('editorial') || t.includes('letter') || t.includes('news')) return 'editorial';
  if (t.includes('preprint')) return 'preprint';
  if (t.includes('article')) return 'article';
  return 'other';
}

export function normalizeWosDocument(doc: WosDocument): Paper | undefined {
  const title = fixAllCaps(cleanText(doc.title));
  if (!doc.uid || !title) return undefined;
  const src = doc.source ?? {};
  const doi = cleanDoi(doc.identifiers?.doi);
  const publicationDate = isoDate(src.publishYear, src.publishMonth);
  const citations = doc.citations?.find((c) => c.db === 'WOS') ?? doc.citations?.[0];

  const paper: Paper = {
    id: '',
    title,
    authors: (doc.names?.authors ?? [])
      .map((a) => a.displayName || a.wosStandard)
      .filter((n): n is string => !!n)
      .map(parseAuthorName),
    journal: src.sourceTitle ? fixAllCaps(cleanText(src.sourceTitle)) : undefined,
    issn: [cleanIssn(doc.identifiers?.issn), cleanIssn(doc.identifiers?.eissn)].filter((x): x is string => !!x),
    volume: src.volume,
    issue: src.issue,
    pages: src.pages?.range || src.articleNumber,
    documentType: documentType([...(doc.types ?? []), ...(doc.sourceTypes ?? [])]),
    publicationDate,
    year: src.publishYear,
    doi,
    url: doi ? `https://doi.org/${doi}` : doc.links?.record,
    citationCount: citations?.count,
    keywords: doc.keywords?.authorKeywords?.map((k) => cleanText(k)).filter(Boolean),
    sources: ['wos'],
    webOfScienceId: doc.uid,
    webOfScienceUrl: doc.links?.record,
  };
  paper.id = makePaperId(paper);
  return compact(paper);
}

/** "crop modelling (APSIM)" → `TS=(crop modelling APSIM)`; WoS ANDs the terms and applies lemmatization. */
export function topicToWosQuery(topic: string): string | undefined {
  const terms = topic.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  // Bare boolean operators would change the meaning of the query.
  const safe = terms.split(' ').filter((w) => !/^(and|or|not|near|same)$/i.test(w)).join(' ');
  return safe ? `TS=(${safe})` : undefined;
}

/** Many journals fit in one query, which is what makes the free 50-requests/day plan workable. */
export function journalsToWosQueries(journals: JournalQuery[], chunkSize = 12): string[] {
  const issns = journals.flatMap((j) => j.issn?.slice(0, 2) ?? []).map(cleanIssn).filter((x): x is string => !!x);
  const queries: string[] = [];
  for (let i = 0; i < issns.length; i += chunkSize) queries.push(`IS=(${issns.slice(i, i + chunkSize).join(' OR ')})`);
  return queries;
}

export interface WebOfScienceConfig {
  apiKey?: string;
  /** Hard cap on requests per pipeline run (default 40 — fits the free plan). */
  maxRequests?: number;
  /** Default 1, the free-plan limit. */
  requestsPerSecond?: number;
  /** Database to search (default WOS = Core Collection). */
  database?: string;
}

/** Thrown for problems that will not go away by retrying another query. */
class WosFatalError extends Error {}

export class WebOfScienceSource implements PaperSource {
  readonly id = 'wos' as const;
  readonly setupHint =
    'Set the WOS_API_KEY repository secret (Web of Science Starter API key) to enable Web of Science.';
  private readonly limiter: RateLimiter;
  private readonly maxRequests: number;
  private requests = 0;

  constructor(private readonly config: WebOfScienceConfig = {}) {
    const rps = Math.max(0.2, config.requestsPerSecond ?? 1);
    this.limiter = new RateLimiter(Math.ceil(1000 / rps) + 100);
    this.maxRequests = Math.max(1, config.maxRequests ?? 40);
  }

  isConfigured(): boolean {
    return !!this.config.apiKey?.trim();
  }

  private async page(q: string, page: number, timeSpan: string, log: Logger): Promise<WosResponse> {
    const qs = new URLSearchParams({
      db: this.config.database ?? 'WOS',
      q,
      limit: String(PAGE_SIZE),
      page: String(page),
      sortField: 'LD+D', // newest additions to the index first
      publishTimeSpan: timeSpan,
    });
    this.requests++;
    try {
      return await getJson<WosResponse>(`${BASE}/documents?${qs}`, {
        limiter: this.limiter,
        attempts: 3,
        headers: { 'X-ApiKey': this.config.apiKey!.trim(), Accept: 'application/json' },
        onRetry: ({ attempt, waitMs, reason }) => {
          this.requests++; // retries count against the daily quota too
          log.warn(`wos: retry ${attempt} in ${Math.round(waitMs / 1000)}s (${reason.slice(0, 120)})`);
        },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 401 || error.status === 403)
          throw new WosFatalError(
            `Web of Science rejected the API key (HTTP ${error.status}). Check that WOS_API_KEY is a valid ` +
              `"Web of Science Starter API" key and that the subscription is approved.`,
          );
        if (error.status === 429)
          throw new WosFatalError('Web of Science quota exhausted (HTTP 429). Lower WOS_MAX_REQUESTS or upgrade the plan.');
      }
      throw error;
    }
  }

  async fetchRecent(req: FetchRequest, log: Logger): Promise<FetchResult> {
    this.requests = 0;
    const papers: Paper[] = [];
    const warnings: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const timeSpan = `${req.fromDate}+${today}`;

    interface Job { label: string; q: string; page: number; got: number; cap: number; done: boolean }
    const journalQueries = journalsToWosQueries(req.journals);
    const jobs: Job[] = [
      ...journalQueries.map((q, i) => ({
        label: `journals (group ${i + 1}/${journalQueries.length})`,
        q, page: 1, got: 0, cap: req.maxPerQuery * 4, done: false,
      })),
      ...req.topics.flatMap((topic) => {
        const q = topicToWosQuery(topic);
        return q ? [{ label: `topic "${topic}"`, q, page: 1, got: 0, cap: req.maxPerQuery, done: false }] : [];
      }),
    ];

    // Breadth-first: page 1 of every query before page 2 of any, so a small
    // request budget still covers every topic and journal group.
    let fatal: string | undefined;
    outer: while (jobs.some((j) => !j.done)) {
      for (const job of jobs) {
        if (job.done) continue;
        if (this.requests >= this.maxRequests) {
          warnings.push(
            `wos: request budget of ${this.maxRequests} reached; some queries were truncated. ` +
              `Raise WOS_MAX_REQUESTS if your plan allows more than 50 requests/day.`,
          );
          break outer;
        }
        try {
          const data = await this.page(job.q, job.page, timeSpan, log);
          const hits = data.hits ?? [];
          for (const hit of hits) {
            const paper = normalizeWosDocument(hit);
            if (paper) papers.push(paper);
          }
          job.got += hits.length;
          const total = data.metadata?.total ?? 0;
          if (job.page === 1) log.info(`wos: ${job.label} → ${total} matches`);
          job.page++;
          job.done = hits.length < PAGE_SIZE || job.got >= Math.min(total, job.cap);
        } catch (error) {
          if (error instanceof WosFatalError) {
            fatal = error.message;
            break outer;
          }
          const msg = `wos: ${job.label} failed — ${(error as Error).message}`;
          warnings.push(msg);
          log.warn(msg);
          job.done = true;
        }
      }
    }

    if (fatal) {
      log.error(`wos: ${fatal}`);
      if (!papers.length) throw new Error(fatal);
      warnings.push(`wos: ${fatal}`);
    }
    return { papers, requests: this.requests, warnings };
  }
}
