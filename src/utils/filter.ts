import { ageInDays, type ScoredPaper } from '../recommendation';
import type { Paper } from '../types/paper';
import type { PaperFilters, SortOrder } from '../types/profile';
import { cleanDoi, dateToTime, journalKey, stripDiacritics } from './normalize';

export function sortScored(items: ScoredPaper[], sort: SortOrder): ScoredPaper[] {
  const time = (s: ScoredPaper) => dateToTime(s.paper.publicationDate) ?? 0;
  const out = [...items];
  if (sort === 'newest') out.sort((a, b) => time(b) - time(a) || b.score - a.score);
  else if (sort === 'citations') out.sort((a, b) => (b.paper.citationCount ?? 0) - (a.paper.citationCount ?? 0) || time(b) - time(a));
  else out.sort((a, b) => b.score - a.score || time(b) - time(a));
  return out;
}

export function applyFilters(
  items: ScoredPaper[],
  filters: PaperFilters,
  ctx: { now: number; isFollowed: (paper: Paper) => boolean },
): ScoredPaper[] {
  const journals = new Set(filters.journals.map(journalKey));
  const filtered = items.filter(({ paper, score }) => {
    if (filters.maxAgeDays > 0) {
      const age = ageInDays(paper, ctx.now);
      if (age === undefined || age > filters.maxAgeDays) return false;
    }
    if (journals.size && !journals.has(journalKey(paper.journal))) return false;
    if (filters.sources.length && !filters.sources.some((s) => paper.sources.includes(s))) return false;
    if (filters.documentTypes.length && !filters.documentTypes.includes(paper.documentType ?? 'other')) return false;
    if (filters.openAccessOnly && !paper.openAccess) return false;
    if (filters.followedJournalsOnly && !ctx.isFollowed(paper)) return false;
    if (filters.minCitations > 0 && (paper.citationCount ?? 0) < filters.minCitations) return false;
    if (filters.minRelevance > 0 && score < filters.minRelevance) return false;
    return true;
  });
  return sortScored(filtered, filters.sort);
}

/** Number of filter settings that differ from "show everything". */
export function activeFilterCount(f: PaperFilters): number {
  return (
    (f.maxAgeDays > 0 ? 1 : 0) + (f.journals.length ? 1 : 0) + (f.sources.length ? 1 : 0) +
    (f.documentTypes.length ? 1 : 0) + (f.openAccessOnly ? 1 : 0) + (f.followedJournalsOnly ? 1 : 0) +
    (f.minCitations > 0 ? 1 : 0) + (f.minRelevance > 0 ? 1 : 0)
  );
}

// --- text search --------------------------------------------------------------

export type SearchField = 'all' | 'title' | 'author' | 'journal' | 'keyword' | 'doi';

interface Haystack { title: string; author: string; journal: string; keyword: string; abstract: string; doi: string }
const haystacks = new WeakMap<Paper, Haystack>();
const fold = (s: string | undefined) => stripDiacritics(s ?? '').toLowerCase();

function haystack(paper: Paper): Haystack {
  let h = haystacks.get(paper);
  if (!h) {
    h = {
      title: fold(paper.title),
      author: fold(paper.authors.map((a) => a.name).join(' | ')),
      journal: fold(paper.journal),
      keyword: fold([...(paper.keywords ?? []), ...(paper.fieldsOfStudy ?? [])].join(' | ')),
      abstract: fold(paper.abstract),
      doi: paper.doi ?? '',
    };
    haystacks.set(paper, h);
  }
  return h;
}

/** `crop "remote sensing" müller` → ["crop", "remote sensing", "muller"] */
export function parseQuery(query: string): string[] {
  const terms: string[] = [];
  for (const m of fold(query).matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim();
    if (term) terms.push(term);
  }
  return terms;
}

/**
 * Match score of a paper for a query (0 = no match). Every term must match;
 * title hits count most. A DOI (or DOI URL) matches exactly.
 */
export function matchQuery(paper: Paper, terms: string[], field: SearchField, rawQuery: string): number {
  if (!terms.length) return 1;
  const h = haystack(paper);
  const doi = cleanDoi(rawQuery);
  if (doi) return h.doi === doi ? 100 : 0;
  if (field === 'doi') return h.doi && terms.every((t) => h.doi.includes(t)) ? 10 : 0;

  let total = 0;
  for (const term of terms) {
    let s = 0;
    if ((field === 'all' || field === 'title') && h.title.includes(term)) s += 4;
    if ((field === 'all' || field === 'keyword') && h.keyword.includes(term)) s += 3;
    if ((field === 'all' || field === 'author') && h.author.includes(term)) s += 3;
    if ((field === 'all' || field === 'journal') && h.journal.includes(term)) s += 2;
    if ((field === 'all' || field === 'keyword') && h.abstract.includes(term)) s += 1;
    if (s === 0) return 0;
    total += s;
  }
  return total;
}
