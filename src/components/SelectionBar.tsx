import { Link, useLocation } from 'react-router-dom';
import { downloadPapers } from '../export';
import { useProfile } from '../store/ProfileContext';
import { useSelection } from '../store/SelectionContext';
import { plural } from '../utils/format';

/** Sticky action bar that follows the selection across every page. */
export function SelectionBar() {
  const selection = useSelection();
  const { isSaved, toggleSaved } = useProfile();
  const { pathname } = useLocation();
  if (selection.count === 0 || pathname === '/export') return null;

  const unsaved = selection.papers.filter((p) => !isSaved(p.id));
  return (
    <div className="selection-bar" role="region" aria-label="Selected papers">
      <strong aria-live="polite">{plural(selection.count, 'paper')} selected</strong>
      <div className="selection-actions">
        <button className="btn btn-primary" onClick={() => downloadPapers(selection.papers, 'bibtex')}>
          Download BibTeX
        </button>
        <button className="btn wide-only" onClick={() => downloadPapers(selection.papers, 'ris')}>RIS</button>
        <button className="btn wide-only" onClick={() => downloadPapers(selection.papers, 'csv')}>CSV</button>
        <Link className="btn" to="/export">More formats…</Link>
        {unsaved.length > 0 && (
          <button className="btn wide-only" onClick={() => unsaved.forEach(toggleSaved)}>Save {unsaved.length}</button>
        )}
        <button className="btn btn-ghost" onClick={selection.clear}>Clear</button>
      </div>
    </div>
  );
}
