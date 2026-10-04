import { useEffect, useState, type ReactNode } from 'react';
import type { ScoredPaper } from '../recommendation';
import { useLibrary } from '../store/LibraryContext';
import { useSelection } from '../store/SelectionContext';
import { plural } from '../utils/format';
import { PaperCard } from './PaperCard';

interface Props {
  items: ScoredPaper[];
  pageSize?: number;
  /** Show the select-all / select-visible toolbar (default true). */
  toolbar?: boolean;
  empty?: ReactNode;
  showScore?: boolean;
  /** Per-paper context lines keyed by paper id. */
  notes?: Map<string, string>;
  /** Rendered at the right of the toolbar (e.g. a sort control). */
  toolbarExtra?: ReactNode;
}

export function PaperList({ items, pageSize = 20, toolbar = true, empty, showScore, notes, toolbarExtra }: Props) {
  const selection = useSelection();
  const { personalized } = useLibrary();
  const [limit, setLimit] = useState(pageSize);

  // A new result set starts from the first page again.
  const signature = `${items.length}:${items[0]?.paper.id ?? ''}`;
  useEffect(() => setLimit(pageSize), [signature, pageSize]);

  if (!items.length) return <div className="empty">{empty ?? 'No papers to show.'}</div>;

  const visible = items.slice(0, limit);
  const selectedHere = items.filter((i) => selection.isSelected(i.paper.id));
  const allVisibleSelected = visible.every((i) => selection.isSelected(i.paper.id));

  return (
    <div className="paper-list">
      {toolbar && (
        <div className="list-toolbar">
          <label className="check-label">
            <input
              type="checkbox"
              className="checkbox"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allVisibleSelected && selectedHere.length > 0;
              }}
              onChange={() =>
                allVisibleSelected ? selection.deselectMany(visible.map((i) => i.paper)) : selection.selectMany(visible.map((i) => i.paper))
              }
            />
            Select visible ({visible.length})
          </label>
          {items.length > visible.length && (
            <button className="link-btn" onClick={() => selection.selectMany(items.map((i) => i.paper))}>
              Select all {items.length.toLocaleString()}
            </button>
          )}
          {selectedHere.length > 0 && (
            <button className="link-btn" onClick={() => selection.deselectMany(items.map((i) => i.paper))}>Clear selection</button>
          )}
          <span className="list-count" aria-live="polite">
            {selectedHere.length > 0 ? `${plural(selectedHere.length, 'paper')} selected · ` : ''}
            {plural(items.length, 'result')}
          </span>
          {toolbarExtra}
        </div>
      )}
      {visible.map((item) => (
        <PaperCard key={item.paper.id} item={item} showScore={showScore ?? personalized} note={notes?.get(item.paper.id)} />
      ))}
      {items.length > limit && (
        <button className="btn btn-block" onClick={() => setLimit((l) => l + pageSize)}>
          Show {Math.min(pageSize, items.length - limit)} more ({(items.length - limit).toLocaleString()} remaining)
        </button>
      )}
    </div>
  );
}
