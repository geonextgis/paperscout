/**
 * Journal ranking (Q1–Q4) from OpenAlex — https://docs.openalex.org (open data,
 * no key required). Pipeline only; the browser reads the result from
 * `journals.json`.
 *
 * The official quartiles (JCR, SJR) are not available through an open API, so
 * this is an estimate built the same way: a journal's 2-year mean citedness
 * (OpenAlex's impact-factor equivalent) is compared with the established,
 * currently cited journals of its main subject field — "established" being the
 * CWTS core sources, roughly the journals the commercial indexes cover. Q1 is
 * the top 25% of the field. Journals without a dominant field (Science, Nature,
 * Scientific Reports…) are compared with all journals instead. The result
 * agrees with the official lists for most journals but can differ by one
 * quartile near a boundary.
 */
import type { JournalInfo, Quartile } from '../types/paper';
import { getJson, RateLimiter } from './http';
import type { Logger } from './sources/types';

const BASE = 'https://api.openalex.org';
const CITEDNESS = 'summary_stats.2yr_mean_citedness';
/** Journals a ranking is made against. Uncited ones are mostly discontinued titles. */
const POOL = `type:journal,is_core:true,${CITEDNESS}:>0`;
/** Below this share of a journal's papers, its largest field does not describe it. */
const MIN_FIELD_SHARE = 1 / 3;
const ALL_FIELDS = 'all';
/** OpenAlex serves only the first 10,000 results of a sorted list. */
const MAX_RANK = 10_000;
const LOOKUP_CHUNK = 50;

interface OpenAlexSource {
  issn?: string[] | null;
  works_count?: number;
  summary_stats?: { '2yr_mean_citedness'?: number | null };
  topics?: { count?: number; field?: { id?: string; display_name?: string } }[];
}

interface SourcesResponse {
  meta: { count: number };
  results: OpenAlexSource[];
  group_by?: { key: string; count: number }[];
}

/** Lowest citedness that still counts as Q1, Q2 and Q3 in a field. */
export type Thresholds = [q1: number, q2: number, q3: number];

export function quartileFor(impact: number, [q1, q2, q3]: Thresholds): Quartile {
  if (impact <= 0) return 4;
  if (impact >= q1) return 1;
  if (impact >= q2) return 2;
  return impact >= q3 ? 3 : 4;
}

/** The field most of a journal's papers fall in; `ALL_FIELDS` for multidisciplinary journals. */
function mainField(source: OpenAlexSource): { id: string; name?: string } | undefined {
  const fields = new Map<string, { id: string; name?: string; count: number }>();
  let total = 0;
  for (const topic of source.topics ?? []) {
    const id = topic.field?.id?.split('/').pop();
    if (!id) continue;
    const entry = fields.get(id) ?? { id, name: topic.field!.display_name, count: 0 };
    entry.count += topic.count ?? 0;
    total += topic.count ?? 0;
    fields.set(id, entry);
  }
  const top = [...fields.values()].sort((a, b) => b.count - a.count)[0];
  if (!top) return undefined;
  return top.count < total * MIN_FIELD_SHARE ? { id: ALL_FIELDS } : top;
}

export interface JournalRankingConfig {
  apiKey?: string;
  mailto?: string;
}

/** Returns the journals with `quartile`, `impact` and `field` filled in where OpenAlex knows them. */
export async function rankJournals(
  journals: JournalInfo[],
  config: JournalRankingConfig,
  log: Logger,
): Promise<{ journals: JournalInfo[]; ranked: number; requests: number }> {
  const limiter = new RateLimiter(config.mailto || config.apiKey ? 120 : 250);
  let requests = 0;
  const get = (params: Record<string, string | number>): Promise<SourcesResponse> => {
    requests++;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    if (config.mailto) qs.set('mailto', config.mailto);
    if (config.apiKey) qs.set('api_key', config.apiKey);
    return getJson<SourcesResponse>(`${BASE}/sources?${qs}`, {
      limiter,
      onRetry: ({ attempt, waitMs, reason }) =>
        log.warn(`openalex: retry ${attempt} in ${Math.round(waitMs / 1000)}s (${reason.slice(0, 120)})`),
    });
  };

  // 1) Look the journals up by ISSN, many per request.
  const byIssn = new Map<string, OpenAlexSource>();
  const issns = journals.flatMap((j) => (j.issn?.[0] ? [j.issn[0]] : []));
  for (let i = 0; i < issns.length; i += LOOKUP_CHUNK) {
    const data = await get({
      filter: `issn:${issns.slice(i, i + LOOKUP_CHUNK).join('|')}`,
      per_page: 100,
      select: 'issn,works_count,summary_stats,topics',
    });
    for (const source of data.results)
      for (const issn of source.issn ?? [])
        if ((source.works_count ?? 0) >= (byIssn.get(issn)?.works_count ?? 0)) byIssn.set(issn, source);
  }

  // 2) Quartile boundaries of every subject field these journals belong to.
  const pool = await get({ filter: POOL, group_by: 'topics.field.id' });
  const sizes = new Map((pool.group_by ?? []).map((g) => [g.key.split('/').pop()!, g.count]));
  const valueAt = async (field: string, rank: number, size: number): Promise<number> => {
    const fromTop = rank <= MAX_RANK;
    const data = await get({
      filter: `${POOL},topics.field.id:${field}`,
      sort: `${CITEDNESS}:${fromTop ? 'desc' : 'asc'}`,
      per_page: 1,
      page: fromTop ? rank : size - rank + 1,
      select: 'summary_stats',
    });
    return data.results[0]?.summary_stats?.['2yr_mean_citedness'] ?? 0;
  };
  const thresholds = new Map<string, Thresholds>();
  for (const field of new Set([...byIssn.values()].map((s) => mainField(s)?.id))) {
    const size = field && sizes.get(field);
    if (!field || !size || size < 40) continue;
    thresholds.set(field, [
      await valueAt(field, Math.ceil(size * 0.25), size),
      await valueAt(field, Math.ceil(size * 0.5), size),
      await valueAt(field, Math.ceil(size * 0.75), size),
    ]);
  }

  // 3) Place each journal in its field, or among all journals when it has none.
  const out: JournalInfo[] = [];
  let ranked = 0;
  for (const journal of journals) {
    const source = journal.issn?.map((i) => byIssn.get(i)).find(Boolean);
    const impact = source?.summary_stats?.['2yr_mean_citedness'];
    const field = source && mainField(source);
    let quartile: Quartile | undefined;
    if (field && typeof impact === 'number') {
      const limits = thresholds.get(field.id);
      if (limits) quartile = quartileFor(impact, limits);
      else if (field.id === ALL_FIELDS && impact <= 0) quartile = 4;
      else if (field.id === ALL_FIELDS && pool.meta.count) {
        const above = await get({ filter: `${POOL},${CITEDNESS}:>${impact}`, per_page: 1, select: 'id' });
        quartile = Math.min(4, Math.floor((above.meta.count / pool.meta.count) * 4) + 1) as Quartile;
      }
    }
    if (!quartile) {
      out.push(journal);
      continue;
    }
    ranked++;
    out.push({ ...journal, quartile, impact: Math.round(impact! * 100) / 100, ...(field!.name && { field: field!.name }) });
  }
  return { journals: out, ranked, requests };
}
