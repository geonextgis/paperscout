import { useMemo, useState } from 'react';
import { lookupDoi, searchWorks } from '../services/sources/crossref';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import type { Paper } from '../types/paper';
import { formatAuthors } from '../utils/format';
import { matchQuery, parseQuery } from '../utils/filter';
import { cleanDoi } from '../utils/normalize';

/**
 * Pick papers that represent the user's interests. Any paper works — recent
 * ones are found in the catalogue, older ones by title or DOI through Crossref.
 */
export function ExamplePaperPicker() {
  const { papers } = useLibrary();
  const profile = useProfile();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Paper[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const examples = profile.profile.examplePapers;

  const local = useMemo(() => {
    const terms = parseQuery(query);
    if (query.trim().length < 3) return [];
    return papers
      .map((p) => ({ p, s: matchQuery(p, terms, 'all', query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((x) => x.p);
  }, [papers, query]);

  const searchCrossref = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const doi = cleanDoi(q);
      const found = doi ? [await lookupDoi(doi)].filter((p): p is Paper => !!p) : await searchWorks(q, { rows: 8 });
      const localIds = new Set(local.map((p) => p.id));
      setRemote(found.filter((p) => !localIds.has(p.id)));
    } catch (e) {
      setError(`Crossref lookup failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const row = (p: Paper, removable: boolean) => {
    const added = profile.isExample(p.id);
    return (
      <li key={p.id} className="pick-row">
        <div>
          <strong>{p.title}</strong>
          <span className="muted">{[formatAuthors(p.authors, 3), p.journal, p.year].filter(Boolean).join(' · ')}</span>
        </div>
        {removable ? (
          <button className="btn btn-small" onClick={() => profile.removeExample(p.id)}>Remove</button>
        ) : (
          <button className={`btn btn-small${added ? ' btn-on' : ''}`} onClick={() => (added ? profile.removeExample(p.id) : profile.addExample(p))}>
            {added ? '✓ Added' : 'Add'}
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="editor">
      {examples.length > 0 && <ul className="pick-list pick-list-current">{examples.map((p) => row(p, true))}</ul>}
      <form className="input-row" onSubmit={(e) => { e.preventDefault(); void searchCrossref(); }}>
        <input
          type="search" value={query} placeholder="Paste a DOI, or type a title / keywords…" aria-label="Find an example paper"
          onChange={(e) => { setQuery(e.target.value); setRemote(null); }}
        />
        <button className="btn" type="submit" disabled={!query.trim() || busy}>{busy ? 'Searching…' : 'Search Crossref'}</button>
      </form>
      {error && <p className="notice notice-error">{error}</p>}
      {(local.length > 0 || remote !== null) && (
        <ul className="pick-list">
          {local.map((p) => row(p, false))}
          {remote?.map((p) => row(p, false))}
        </ul>
      )}
      {remote !== null && !remote.length && !local.length && <p className="muted">Nothing found. Try the DOI or the exact title.</p>}
      <p className="muted">
        Tip: every paper card also has a <em>More like this</em> button that adds it here.
      </p>
    </div>
  );
}
