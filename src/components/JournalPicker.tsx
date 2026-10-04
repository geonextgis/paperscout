import { useMemo, useState } from 'react';
import { searchJournals } from '../services/sources/crossref';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import type { JournalInfo } from '../types/paper';
import { journalKey } from '../utils/normalize';

/**
 * Follow / unfollow journals. Suggestions come from the catalogue first; any
 * other journal can be found through a live Crossref title search.
 */
export function JournalPicker({ showFollowed = true }: { showFollowed?: boolean }) {
  const { journals } = useLibrary();
  const profile = useProfile();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<JournalInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const local = useMemo(() => {
    const q = journalKey(query);
    const pool = journals.filter((j) => j.name !== 'arXiv');
    if (!q) return pool.filter((j) => j.tracked || j.paperCount >= 5).slice(0, 12);
    return pool.filter((j) => journalKey(j.name).includes(q)).slice(0, 10);
  }, [journals, query]);

  const searchCrossref = async () => {
    setBusy(true);
    setError(null);
    try {
      const localKeys = new Set(local.map((j) => journalKey(j.name)));
      setRemote((await searchJournals(query.trim())).filter((j) => !localKeys.has(journalKey(j.name))));
    } catch (e) {
      setError(`Crossref search failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const row = (j: JournalInfo) => {
    const following = profile.isFollowing(j.name);
    return (
      <li key={`${j.name}-${j.issn?.[0] ?? ''}`} className="pick-row">
        <div>
          <strong>{j.name}</strong>
          <span className="muted">
            {[j.issn?.[0] && `ISSN ${j.issn[0]}`, j.publisher, j.paperCount > 0 ? `${j.paperCount} recent papers` : 'not in the shared catalogue yet']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <button
          className={`btn btn-small${following ? ' btn-on' : ''}`}
          onClick={() => (following ? profile.unfollowJournal(j.name) : profile.followJournal(j))}
        >
          {following ? '★ Following' : 'Follow'}
        </button>
      </li>
    );
  };

  return (
    <div className="editor">
      {showFollowed && profile.profile.journals.length > 0 && (
        <div className="chips" aria-label="Followed journals">
          {profile.profile.journals.map((j) => (
            <span key={j.name} className="chip chip-on">
              {j.name}
              <button className="chip-x" onClick={() => profile.unfollowJournal(j.name)} aria-label={`Unfollow ${j.name}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <form className="input-row" onSubmit={(e) => { e.preventDefault(); if (query.trim()) void searchCrossref(); }}>
        <input
          type="search" value={query} placeholder="Search journals by title…" aria-label="Search journals"
          onChange={(e) => { setQuery(e.target.value); setRemote(null); }}
        />
        <button className="btn" type="submit" disabled={!query.trim() || busy}>{busy ? 'Searching…' : 'Search all journals'}</button>
      </form>
      {error && <p className="notice notice-error">{error}</p>}
      <ul className="pick-list">
        {local.map(row)}
        {remote?.map(row)}
      </ul>
      {query.trim() && !local.length && remote === null && (
        <p className="muted">Not in the catalogue. Press “Search all journals” to look it up in Crossref.</p>
      )}
      {remote !== null && !remote.length && !local.length && <p className="muted">No journal found with that title.</p>}
    </div>
  );
}
