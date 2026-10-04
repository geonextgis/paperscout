import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { downloadPapers, EXPORT_FORMATS, exportPapers, type ExportFormat } from '../export';
import { uniquePapers } from '../export/bibtex';
import { useProfile } from '../store/ProfileContext';
import { useSelection } from '../store/SelectionContext';
import { formatAuthors, plural } from '../utils/format';

const PREVIEW_CHARS = 6000;

export function ExportPage() {
  const selection = useSelection();
  const { profile } = useProfile();
  const [format, setFormat] = useState<ExportFormat>('bibtex');
  const [includeAbstract, setIncludeAbstract] = useState(false);
  const [asciiOnly, setAsciiOnly] = useState(false);
  const [maxAuthors, setMaxAuthors] = useState(0);
  const [copied, setCopied] = useState(false);

  const options = useMemo(() => ({ includeAbstract, asciiOnly, maxAuthors }), [includeAbstract, asciiOnly, maxAuthors]);
  const papers = selection.papers;
  const unique = useMemo(() => uniquePapers(papers), [papers]);
  const output = useMemo(() => (papers.length ? exportPapers(papers, format, options) : ''), [papers, format, options]);
  const duplicates = papers.length - unique.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the download button still works */
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Export</h1>
        <p className="muted">Turn your selection into a bibliography file. Everything happens in your browser.</p>
      </div>

      {!papers.length ? (
        <div className="empty">
          No papers selected. Tick the checkbox on any paper card
          {profile.savedPapers.length > 0 && (
            <>
              , or <button className="link-btn" onClick={() => selection.selectMany(profile.savedPapers)}>select your {plural(profile.savedPapers.length, 'saved paper')}</button>
            </>
          )}
          . <Link to="/">Back to the feed</Link>
        </div>
      ) : (
        <div className="export-grid">
          <section className="panel">
            <h2>{plural(unique.length, 'paper')} selected</h2>
            {duplicates > 0 && <p className="muted">{plural(duplicates, 'duplicate')} (same DOI) will be exported once.</p>}

            <fieldset className="field">
              <legend>Format</legend>
              <div className="chips">
                {(Object.keys(EXPORT_FORMATS) as ExportFormat[]).map((f) => (
                  <button key={f} className={`chip chip-toggle${format === f ? ' chip-on' : ''}`} aria-pressed={format === f} onClick={() => setFormat(f)}>
                    {EXPORT_FORMATS[f].label} <span className="muted">.{EXPORT_FORMATS[f].extension}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {format !== 'csv' && (
              <label className="check-label">
                <input type="checkbox" className="checkbox" checked={includeAbstract} onChange={(e) => setIncludeAbstract(e.target.checked)} />
                Include abstracts
              </label>
            )}
            {format === 'bibtex' && (
              <>
                <label className="check-label">
                  <input type="checkbox" className="checkbox" checked={asciiOnly} onChange={(e) => setAsciiOnly(e.target.checked)} />
                  ASCII only — write accents as LaTeX commands (for classic BibTeX without UTF-8)
                </label>
                <label className="field">
                  <span>Long author lists</span>
                  <select value={maxAuthors} onChange={(e) => setMaxAuthors(Number(e.target.value))}>
                    <option value={0}>Keep all authors</option>
                    <option value={10}>First 10, then “and others”</option>
                    <option value={25}>First 25, then “and others”</option>
                    <option value={50}>First 50, then “and others”</option>
                  </select>
                </label>
              </>
            )}

            <div className="action-row">
              <button className="btn btn-primary" onClick={() => downloadPapers(papers, format, options)}>
                Download {EXPORT_FORMATS[format].label}
              </button>
              <button className="btn" onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy to clipboard'}</button>
              <button className="btn btn-ghost" onClick={selection.clear}>Clear selection</button>
            </div>

            <ul className="pick-list">
              {unique.map((p) => (
                <li key={p.id} className="pick-row">
                  <div>
                    <strong>{p.title}</strong>
                    <span className="muted">{[formatAuthors(p.authors, 2), p.journal, p.year].filter(Boolean).join(' · ')}</span>
                  </div>
                  <button className="btn btn-small" onClick={() => selection.toggle(p)}>Remove</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Preview</h2>
            <pre className="preview" tabIndex={0}>
              {output.replace(/^﻿/, '').slice(0, PREVIEW_CHARS)}
              {output.length > PREVIEW_CHARS && '\n… (preview truncated — the download contains everything)'}
            </pre>
          </section>
        </div>
      )}
    </>
  );
}
