import { useMemo, useState } from 'react';
import { FilterPanel } from '../components/FilterPanel';
import { PaperList } from '../components/PaperList';
import { journalMatcher } from '../recommendation';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import type { SortOrder } from '../types/profile';
import { applyFilters } from '../utils/filter';

export function LatestPage() {
  const { scored, papers, now, loading, journalOf } = useLibrary();
  const { profile, setFilters } = useProfile();
  // "Latest" always opens newest-first; the other filters are the user's saved preferences.
  const [sort, setSort] = useState<SortOrder>('newest');

  const items = useMemo(
    () => applyFilters(scored, { ...profile.filters, sort }, { now, isFollowed: journalMatcher(profile.journals), quartileOf: (p) => journalOf(p)?.quartile }),
    [scored, profile.filters, profile.journals, sort, now, journalOf],
  );

  return (
    <>
      <div className="page-head">
        <h1>Latest</h1>
        <p className="muted">Everything in the catalogue. Your filter choices are remembered.</p>
      </div>
      <FilterPanel filters={profile.filters} onChange={setFilters} papers={papers} sortValue={sort} onSortChange={(v) => setSort(v as SortOrder)} />
      {loading ? <div className="empty">Loading the catalogue…</div> : <PaperList items={items} empty="No papers match these filters." />}
    </>
  );
}
