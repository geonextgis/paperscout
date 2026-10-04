import { useMemo, useState } from 'react';
import { PaperList } from '../components/PaperList';
import { downloadPapers } from '../export';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import { useSelection } from '../store/SelectionContext';
import type { SortOrder } from '../types/profile';
import { sortScored } from '../utils/filter';

export function SavedPage() {
  const { score } = useLibrary();
  const { profile } = useProfile();
  const selection = useSelection();
  const [sort, setSort] = useState<'saved' | SortOrder>('saved');
  const saved = profile.savedPapers;

  const items = useMemo(() => {
    const scored = saved.map(score);
    return sort === 'saved' ? scored : sortScored(scored, sort);
  }, [saved, score, sort]);

  return (
    <>
      <div className="page-head">
        <h1>Saved papers</h1>
        <p className="muted">Bookmarks are stored in this browser and stay available after papers leave the rolling catalogue.</p>
      </div>
      {saved.length > 0 && (
        <div className="action-row">
          <button className="btn btn-primary" onClick={() => downloadPapers(saved, 'bibtex')}>Download all as BibTeX</button>
          <button className="btn" onClick={() => downloadPapers(saved, 'ris')}>RIS</button>
          <button className="btn" onClick={() => downloadPapers(saved, 'csv')}>CSV</button>
          <button className="btn" onClick={() => selection.selectMany(saved)}>Select all saved</button>
        </div>
      )}
      <PaperList
        items={items}
        toolbarExtra={
          <select className="inline-select" value={sort} onChange={(e) => setSort(e.target.value as 'saved' | SortOrder)} aria-label="Sort">
            <option value="saved">Recently saved</option>
            <option value="relevance">Relevance</option>
            <option value="newest">Newest first</option>
            <option value="citations">Most cited</option>
          </select>
        }
        empty="Nothing saved yet. Use ☆ Save on any paper to bookmark it."
      />
    </>
  );
}
