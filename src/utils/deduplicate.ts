/**
 * Deduplicate and merge records that describe the same paper.
 *
 * Two records are the same paper when they share a DOI, arXiv id, WoS UID or
 * Semantic Scholar id — or when they have the same normalized title and a
 * compatible first author (catches preprint ↔ journal version and DOI-less
 * records). Merging keeps the best value per field rather than one whole record.
 */
import type { Paper, SourceId } from '../types/paper';
import { makePaperId, titleKey } from './normalize';

/** Which source to trust for bibliographic fields, best first. */
const BIBLIO_PRIORITY: SourceId[] = ['crossref', 'wos', 'semanticscholar', 'arxiv'];

const ARXIV_DOI = /^10\.48550\//;

function rank(p: Paper): number {
  const ranks = p.sources.map((s) => BIBLIO_PRIORITY.indexOf(s)).filter((r) => r >= 0);
  return ranks.length ? Math.min(...ranks) : BIBLIO_PRIORITY.length;
}

function union<T>(a: T[] | undefined, b: T[] | undefined, key: (x: T) => string): T[] | undefined {
  if (!a?.length) return b?.length ? b : undefined;
  if (!b?.length) return a;
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((x) => !seen.has(key(x)))];
}

function firstFamily(p: Paper): string {
  const a = p.authors[0];
  if (!a) return '';
  return titleKey(a.family ?? a.name.split(' ').pop() ?? '');
}

/** Guard for title-based matches: never merge two records that carry different publisher DOIs. */
function compatible(a: Paper, b: Paper): boolean {
  if (a.doi && b.doi && a.doi !== b.doi && !ARXIV_DOI.test(a.doi) && !ARXIV_DOI.test(b.doi)) return false;
  const fa = firstFamily(a);
  const fb = firstFamily(b);
  if (fa && fb && fa !== fb && !fa.includes(fb) && !fb.includes(fa)) return false;
  if (a.year && b.year && Math.abs(a.year - b.year) > 2) return false;
  return true;
}

export function mergePapers(a: Paper, b: Paper): Paper {
  // `p` = preferred record for bibliographic fields, `s` = secondary.
  const [p, s] = rank(a) <= rank(b) ? [a, b] : [b, a];
  const published = [p, s].find((x) => x.documentType && x.documentType !== 'preprint');
  // A publisher DOI beats an arXiv DOI.
  const doi = [p.doi, s.doi].find((d) => d && !ARXIV_DOI.test(d)) ?? p.doi ?? s.doi;
  const date =
    (s.publicationDate?.length ?? 0) > (p.publicationDate?.length ?? 0) && (!p.year || s.year === p.year)
      ? s.publicationDate
      : (p.publicationDate ?? s.publicationDate);
  const wos = [p, s].find((x) => x.sources.includes('wos'));

  const merged: Paper = {
    ...s,
    ...p,
    doi,
    title: p.title || s.title,
    abstract: (s.abstract?.length ?? 0) > (p.abstract?.length ?? 0) ? s.abstract : p.abstract,
    authors: s.authors.length > p.authors.length ? s.authors : p.authors,
    journal: published?.journal ?? p.journal ?? s.journal,
    documentType: published?.documentType ?? p.documentType ?? s.documentType,
    publicationDate: date,
    year: p.year ?? s.year,
    url: p.url ?? s.url,
    pdfUrl: p.pdfUrl ?? s.pdfUrl,
    openAccess: p.openAccess || s.openAccess || undefined,
    // Web of Science counts are curated; otherwise take the larger number.
    citationCount:
      wos?.citationCount ??
      (p.citationCount !== undefined || s.citationCount !== undefined
        ? Math.max(p.citationCount ?? 0, s.citationCount ?? 0)
        : undefined),
    keywords: union(p.keywords, s.keywords, (k) => k.toLowerCase()),
    fieldsOfStudy: union(p.fieldsOfStudy, s.fieldsOfStudy, (k) => k.toLowerCase()),
    issn: union(p.issn, s.issn, (k) => k),
    sources: union(p.sources, s.sources, (k) => k) ?? [],
    webOfScienceId: p.webOfScienceId ?? s.webOfScienceId,
    webOfScienceUrl: p.webOfScienceUrl ?? s.webOfScienceUrl,
    semanticScholarId: p.semanticScholarId ?? s.semanticScholarId,
    arxivId: p.arxivId ?? s.arxivId,
    firstSeen: [p.firstSeen, s.firstSeen].filter(Boolean).sort()[0],
  };
  merged.id = makePaperId(merged);
  for (const k of Object.keys(merged) as (keyof Paper)[]) if (merged[k] === undefined) delete merged[k];
  return merged;
}

/**
 * Deduplicate a list. Order matters only for ties: earlier records win.
 * Runs in O(n) using identifier indexes.
 */
export function deduplicate(papers: Paper[]): Paper[] {
  const slots: (Paper | null)[] = [];
  const index = new Map<string, number>();

  const keysOf = (p: Paper): string[] => {
    const keys: string[] = [];
    if (p.doi) keys.push(`doi:${p.doi}`);
    if (p.arxivId) keys.push(`arxiv:${p.arxivId}`);
    if (p.webOfScienceId) keys.push(`wos:${p.webOfScienceId}`);
    if (p.semanticScholarId) keys.push(`s2:${p.semanticScholarId}`);
    return keys;
  };
  const fuzzyKey = (p: Paper): string | undefined => {
    const t = titleKey(p.title);
    return t.length >= 25 ? `title:${t}` : undefined;
  };

  for (const paper of papers) {
    if (!paper.title) continue;
    const matches = new Set<number>();
    for (const k of keysOf(paper)) {
      const i = index.get(k);
      if (i !== undefined) matches.add(i);
    }
    const fk = fuzzyKey(paper);
    if (fk) {
      const i = index.get(fk);
      if (i !== undefined && slots[i] && compatible(slots[i]!, paper)) matches.add(i);
    }

    let merged = paper;
    let target = slots.length;
    if (matches.size) {
      const ordered = [...matches].sort((x, y) => x - y);
      target = ordered[0];
      for (const i of ordered) {
        merged = mergePapers(slots[i]!, merged);
        if (i !== target) slots[i] = null;
      }
    }
    slots[target] = merged;
    for (const k of keysOf(merged)) index.set(k, target);
    const mk = fuzzyKey(merged);
    if (mk && (index.get(mk) === undefined || !slots[index.get(mk)!] || matches.has(index.get(mk)!))) index.set(mk, target);
  }
  return slots.filter((p): p is Paper => p !== null);
}
