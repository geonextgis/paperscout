import { useMemo, useState } from 'react';
import { JournalPicker } from '../components/JournalPicker';
import { PaperList } from '../components/PaperList';
import { journalMatcher } from '../recommendation';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import type { SortOrder } from '../types/profile';
import { sortScored } from '../utils/filter';

export function JournalsPage() {
  const { scored } = useLibrary();
  const { profile } = useProfile();
  const [only, setOnly] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>('newest');

  const active = profile.journals.find((j) => j.name === only) ?? null;
  const counts = useMemo(
    () => new Map(profile.journals.map((j) => [j.name, scored.filter((s) => journalMatcher([j])(s.paper)).length])),
    [profile.journals, scored],
  );
  const items = useMemo(() => {
    const match = journalMatcher(active ? [active] : profile.journals);
    return sortScored(scored.filter((s) => match(s.paper)), sort);
  }, [scored, profile.journals, active, sort]);

  return (
    <>
      <div className="page-head">
        <h1>Journals</h1>
        <p className="muted">Papers in followed journals rank higher everywhere and get their own feed below.</p>
      </div>

      <section className="panel">
        <h2>Follow journals</h2>
        <JournalPicker />
      </section>

      <section className="feed-section">
        <div className="section-head">
          <h2>Papers from followed journals</h2>
        </div>
        {profile.journals.length > 0 && (
          <div className="chips filter-chips">
            <button className={`chip chip-toggle${!active ? ' chip-on' : ''}`} onClick={() => setOnly(null)}>All followed</button>
            {profile.journals.map((j) => (
              <button key={j.name} className={`chip chip-toggle${active?.name === j.name ? ' chip-on' : ''}`} onClick={() => setOnly(j.name)}>
                {j.name} <span className="muted">{counts.get(j.name) ?? 0}</span>
              </button>
            ))}
          </div>
        )}
        <PaperList
          items={items}
          toolbarExtra={
            <select className="inline-select" value={sort} onChange={(e) => setSort(e.target.value as SortOrder)} aria-label="Sort">
              <option value="newest">Newest first</option>
              <option value="relevance">Relevance</option>
              <option value="citations">Most cited</option>
            </select>
          }
          empty={
            profile.journals.length
              ? 'No recent papers from these journals in the catalogue. Use “Fetch papers for my profile” in Settings to pull them from Crossref.'
              : 'Follow a journal above to see its latest papers here.'
          }
        />
      </section>
    </>
  );
}
