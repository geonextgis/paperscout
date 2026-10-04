/**
 * arXiv API — https://info.arxiv.org/help/api/ (public, no key).
 * Terms of use ask for at most one request every three seconds.
 */
import { XMLParser } from 'fast-xml-parser';
import type { Paper } from '../../types/paper';
import { getText, RateLimiter } from '../http';
import { cleanDoi, cleanText, compact, makePaperId, parseAuthorName } from '../../utils/normalize';
import type { FetchRequest, FetchResult, Logger, PaperSource } from './types';

const BASE = 'https://export.arxiv.org/api/query';

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: { name?: string; 'arxiv:affiliation'?: string | string[] }[];
  link?: { '@_href'?: string; '@_title'?: string; '@_rel'?: string }[];
  category?: { '@_term'?: string }[];
  'arxiv:doi'?: string;
  'arxiv:journal_ref'?: string;
  'arxiv:primary_category'?: { '@_term'?: string };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (name) => ['entry', 'author', 'link', 'category'].includes(name),
});

export function parseArxivFeed(xml: string): Paper[] {
  const feed = parser.parse(xml)?.feed;
  const entries: ArxivEntry[] = feed?.entry ?? [];
  return entries.map(normalizeArxivEntry).filter((p): p is Paper => !!p);
}

export function normalizeArxivEntry(entry: ArxivEntry): Paper | undefined {
  // http://arxiv.org/abs/2401.12345v2 → 2401.12345
  const arxivId = entry.id?.match(/abs\/(.+?)(v\d+)?$/)?.[1];
  const title = cleanText(entry.title);
  if (!arxivId || !title) return undefined;
  const published = entry.published?.slice(0, 10);
  const categories = [
    entry['arxiv:primary_category']?.['@_term'],
    ...(entry.category ?? []).map((c) => c['@_term']),
  ].filter((c): c is string => !!c && /^[a-z-]+(\.[A-Za-z-]+)?$/.test(c));

  const paper: Paper = {
    id: '',
    title,
    abstract: cleanText(entry.summary) || undefined,
    authors: (entry.author ?? []).filter((a) => a.name).map((a) => {
      const aff = Array.isArray(a['arxiv:affiliation']) ? a['arxiv:affiliation'][0] : a['arxiv:affiliation'];
      return { ...parseAuthorName(a.name!), ...(aff && { affiliation: cleanText(aff) }) };
    }),
    journal: 'arXiv',
    documentType: 'preprint',
    publicationDate: published,
    year: published ? Number(published.slice(0, 4)) : undefined,
    // Prefer the DOI of the published version when the authors supplied one.
    doi: cleanDoi(entry['arxiv:doi']) ?? `10.48550/arxiv.${arxivId.toLowerCase()}`,
    url: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    openAccess: true,
    fieldsOfStudy: [...new Set(categories)],
    sources: ['arxiv'],
    arxivId,
  };
  paper.id = makePaperId(paper);
  return compact(paper);
}

/** "crop modelling" → `all:crop AND all:modelling` */
export function topicToArxivQuery(topic: string): string {
  const words = topic.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.map((w) => `all:${w}`).join(' AND ');
}

export class ArxivSource implements PaperSource {
  readonly id = 'arxiv' as const;
  private readonly limiter = new RateLimiter(3200);

  isConfigured(): boolean {
    return true;
  }

  async fetchRecent(req: FetchRequest, log: Logger): Promise<FetchResult> {
    const papers: Paper[] = [];
    const warnings: string[] = [];
    let requests = 0;
    const pageSize = Math.min(100, req.maxPerQuery);

    for (const topic of req.topics) {
      const query = topicToArxivQuery(topic);
      if (!query) continue;
      try {
        let got = 0;
        for (let start = 0; start < req.maxPerQuery; start += pageSize) {
          const qs = new URLSearchParams({
            search_query: query,
            sortBy: 'submittedDate',
            sortOrder: 'descending',
            start: String(start),
            max_results: String(pageSize),
          });
          requests++;
          const xml = await getText(`${BASE}?${qs}`, {
            limiter: this.limiter,
            backoffMs: 5000,
            timeoutMs: 45_000,
            onRetry: ({ attempt, waitMs }) => log.warn(`arxiv: retry ${attempt} in ${Math.round(waitMs / 1000)}s`),
          });
          const page = parseArxivFeed(xml);
          const recent = page.filter((p) => (p.publicationDate ?? '') >= req.fromDate);
          papers.push(...recent);
          got += recent.length;
          // Results are newest-first: stop as soon as a page reaches older papers.
          if (page.length < pageSize || recent.length < page.length) break;
        }
        log.info(`arxiv: topic "${topic}" → ${got} records`);
      } catch (error) {
        const msg = `arxiv: topic "${topic}" failed — ${(error as Error).message}`;
        warnings.push(msg);
        log.warn(msg);
      }
    }
    return { papers, requests, warnings };
  }
}
