import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterPanel } from '../components/FilterPanel';
import { PaperList } from '../components/PaperList';
import { journalMatcher, type ScoredPaper } from '../recommendation';
import { searchWorks } from '../services/sources/crossref';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import { DEFAULT_FILTERS, type PaperFilters, type SortOrder } from '../types/profile';
import { applyFilters, matchQuery, parseQuery, type SearchField } from '../utils/filter';

const FIELDS: { value: SearchField; label: string }[] = [
  { value: 'all', label: 'All fields' },
  { value: 'title', label: 'Title' },
  { value: 'keyword', label: 'Keyword / topic' },
  { value: 'author', label: 'Author' },
  { value: 'journal', label: 'Journal' },
  { value: 'doi', label: 'DOI' },
];

export function SearchPage() {
  const { papers, score, now } = useLibrary();
  const { profile } = useProfile();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const field = (params.get('in') as SearchField) || 'all';
  const [draft, setDraft] = useState(query);
  const [filters, setFilters] = useState<PaperFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<'match' | SortOrder>('match');
  const [live, setLive] = useState<{ query: string; items: ScoredPaper[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search the catalogue plus everything the user has kept, so saved papers stay findable.
  const pool = useMemo(() => {
    const seen = new Set<string>();
    return [...papers, ...profile.savedPapers, ...profile.examplePapers].filter((p) => !seen.has(p.id) && seen.add(p.id));
  }, [papers, profile.savedPapers, profile.examplePapers]);

  const results = useMemo(() => {
    const terms = parseQuery(query);
    const matched = pool
      .map((paper) => ({ paper, match: matchQuery(paper, terms, field, query) }))
      .filter((m) => m.match > 0);
    const matchScore = new Map(matched.map((m) => [m.paper.id, m.match]));
    const filtered = applyFilters(
      matched.map((m) => score(m.paper)),
      { ...filters, sort: sort === 'match' ? 'relevance' : sort },
      { now, isFollowed: journalMatcher(profile.journals) },
    );
    if (sort === 'match' && terms.length)
      filtered.sort((a, b) => matchScore.get(b.paper.id)! - matchScore.get(a.paper.id)! || b.score - a.score);
    return filtered;
  }, [pool, query, field, filters, sort, score, now, profile.journals]);

  const submit = (q: string, f: SearchField) => {
    setLive(null);
    setParams(q ? { q, ...(f !== 'all' && { in: f }) } : {}, { replace: true });
  };

  const searchLive = async () => {
    setBusy(true);
    setError(null);
    try {
      const known = new Set(pool.map((p) => p.id));
      const found = await searchWorks(query, { rows: 30 });
      setLive({ query, items: found.filter((p) => !known.has(p.id)).map(score) });
    } catch (e) {
      setError(`Crossref search failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Search</h1>
        <p className="muted">Search the catalogue by title, keyword, author, journal or DOI. Use quotes for exact phrases.</p>
      </div>

      <form className="search-form" onSubmit={(e) => { e.preventDefault(); submit(draft.trim(), field); }}>
        <input
          type="search" value={draft} autoFocus placeholder='e.g.  "crop model" sentinel-2   or   10.1016/j.rse…'
          aria-label="Search query" onChange={(e) => setDraft(e.target.value)}
        />
        <select value={field} aria-label="Search in" onChange={(e) => submit(draft.trim(), e.target.value as SearchField)}>
          {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <button className="btn btn-primary" type="submit">Search</button>
      </form>

      <FilterPanel
        filters={filters} onChange={(c) => setFilters((f) => ({ ...f, ...c }))} papers={pool}
        extraSorts={[{ value: 'match', label: 'Best match' }]} sortValue={sort} onSortChange={(v) => setSort(v as 'match' | SortOrder)}
      />

      <PaperList items={results} empty={query ? `No catalogued papers match “${query}”.` : 'The catalogue is empty.'} />

      {query && (
        <section className="feed-section">
          <div className="section-head">
            <h2>Beyond the catalogue</h2>
            <p className="muted">
              The catalogue only holds recent papers. Search Crossref’s 150+ million records for older or uncatalogued work — you can save, select and export those too.
            </p>
          </div>
          {live?.query === query ? (
            <PaperList items={live.items} empty="Crossref returned nothing new for this query." />
          ) : (
            <button className="btn" onClick={() => void searchLive()} disabled={busy}>
              {busy ? 'Searching Crossref…' : `Search Crossref for “${query}”`}
            </button>
          )}
          {error && <p className="notice notice-error">{error}</p>}
        </section>
      )}
    </>
  );
}
