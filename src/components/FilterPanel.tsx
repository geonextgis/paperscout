import { useMemo } from 'react';
import { DOCUMENT_TYPE_LABELS, SOURCE_LABELS, type DocumentType, type Paper, type Quartile, type SourceId } from '../types/paper';
import { DEFAULT_FILTERS, type PaperFilters, type SortOrder } from '../types/profile';
import { activeFilterCount } from '../utils/filter';

interface Props {
  filters: PaperFilters;
  onChange(change: Partial<PaperFilters>): void;
  /** Papers the filters apply to — used to offer only values that exist. */
  papers: Paper[];
  /** Additional sort choices, e.g. "Best match" on the search page. */
  extraSorts?: { value: string; label: string }[];
  sortValue?: string;
  onSortChange?(value: string): void;
}

const AGE_OPTIONS = [
  { value: 0, label: 'Any time' },
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function FilterPanel({ filters, onChange, papers, extraSorts = [], sortValue, onSortChange }: Props) {
  const { journals, sources, types } = useMemo(() => {
    const journalCounts = new Map<string, number>();
    const sourceSet = new Set<SourceId>();
    const typeSet = new Set<DocumentType>();
    for (const p of papers) {
      if (p.journal) journalCounts.set(p.journal, (journalCounts.get(p.journal) ?? 0) + 1);
      p.sources.forEach((s) => sourceSet.add(s));
      typeSet.add(p.documentType ?? 'other');
    }
    return {
      journals: [...journalCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300),
      sources: (Object.keys(SOURCE_LABELS) as SourceId[]).filter((s) => sourceSet.has(s)),
      types: (Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).filter((t) => typeSet.has(t)),
    };
  }, [papers]);

  const active = activeFilterCount(filters);

  return (
    <details className="filters" open={window.matchMedia('(min-width: 900px)').matches || undefined}>
      <summary>
        Filters &amp; sorting {active > 0 && <span className="nav-count">{active}</span>}
      </summary>
      <div className="filters-grid">
        <label className="field">
          <span>Sort by</span>
          <select
            value={sortValue ?? filters.sort}
            onChange={(e) => (onSortChange ? onSortChange(e.target.value) : onChange({ sort: e.target.value as SortOrder }))}
          >
            {extraSorts.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            <option value="relevance">Relevance to my profile</option>
            <option value="newest">Newest first</option>
            <option value="citations">Most cited</option>
          </select>
        </label>

        <label className="field">
          <span>Publication date</span>
          <select value={filters.maxAgeDays} onChange={(e) => onChange({ maxAgeDays: Number(e.target.value) })}>
            {AGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>Journal</span>
          <select
            value=""
            onChange={(e) => e.target.value && onChange({ journals: toggle(filters.journals, e.target.value) })}
          >
            <option value="">{filters.journals.length ? `${filters.journals.length} selected — add another…` : 'All journals'}</option>
            {journals.map(([name, count]) => (
              <option key={name} value={name}>{filters.journals.includes(name) ? '✓ ' : ''}{name} ({count})</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Minimum citations</span>
          <input
            type="number" min={0} step={1} value={filters.minCitations || ''} placeholder="0"
            onChange={(e) => onChange({ minCitations: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>

        <label className="field">
          <span>Minimum relevance: {filters.minRelevance}%</span>
          <input type="range" min={0} max={90} step={5} value={filters.minRelevance} onChange={(e) => onChange({ minRelevance: Number(e.target.value) })} />
        </label>

        <div className="field">
          <span>Access &amp; journals</span>
          <label className="check-label">
            <input type="checkbox" className="checkbox" checked={filters.openAccessOnly} onChange={(e) => onChange({ openAccessOnly: e.target.checked })} />
            Open access only
          </label>
          <label className="check-label">
            <input type="checkbox" className="checkbox" checked={filters.followedJournalsOnly} onChange={(e) => onChange({ followedJournalsOnly: e.target.checked })} />
            Followed journals only
          </label>
        </div>

        <div className="field field-wide">
          <span>Journal ranking</span>
          <div className="chips">
            {([1, 2, 3, 4] as Quartile[]).map((q) => (
              <button key={q} className={`chip chip-toggle${filters.quartiles.includes(q) ? ' chip-on' : ''}`} aria-pressed={filters.quartiles.includes(q)}
                onClick={() => onChange({ quartiles: toggle(filters.quartiles, q) })}>
                Q{q}
              </button>
            ))}
          </div>
        </div>

        <div className="field field-wide">
          <span>Source</span>
          <div className="chips">
            {sources.map((s) => (
              <button key={s} className={`chip chip-toggle${filters.sources.includes(s) ? ' chip-on' : ''}`} aria-pressed={filters.sources.includes(s)}
                onClick={() => onChange({ sources: toggle(filters.sources, s) })}>
                {SOURCE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="field field-wide">
          <span>Document type</span>
          <div className="chips">
            {types.map((t) => (
              <button key={t} className={`chip chip-toggle${filters.documentTypes.includes(t) ? ' chip-on' : ''}`} aria-pressed={filters.documentTypes.includes(t)}
                onClick={() => onChange({ documentTypes: toggle(filters.documentTypes, t) })}>
                {DOCUMENT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {filters.journals.length > 0 && (
          <div className="field field-wide">
            <span>Selected journals</span>
            <div className="chips">
              {filters.journals.map((j) => (
                <span key={j} className="chip">
                  {j}
                  <button className="chip-x" aria-label={`Remove ${j}`} onClick={() => onChange({ journals: filters.journals.filter((x) => x !== j) })}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      {active > 0 && (
        <button className="link-btn" onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}>Reset filters</button>
      )}
    </details>
  );
}
