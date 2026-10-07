import { memo, useState } from 'react';
import type { ScoredPaper } from '../recommendation';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import { useSelection } from '../store/SelectionContext';
import { DOCUMENT_TYPE_LABELS, SOURCE_LABELS } from '../types/paper';
import { formatAuthors, formatDate } from '../utils/format';
import { QuartileBadge } from './QuartileBadge';

interface Props {
  item: ScoredPaper;
  /** Hide the relevance badge (e.g. before the user has defined any interests). */
  showScore?: boolean;
  /** Extra context line, e.g. "Similar to your saved paper …". */
  note?: string;
}

function scoreTier(score: number): string {
  return score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';
}

function PaperCardImpl({ item, showScore = true, note }: Props) {
  const { paper, score, reasons, matchedTopics, breakdown } = item;
  const profile = useProfile();
  const { journalOf } = useLibrary();
  const selection = useSelection();
  const [showAbstract, setShowAbstract] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [allAuthors, setAllAuthors] = useState(false);

  const selected = selection.isSelected(paper.id);
  const saved = profile.isSaved(paper.id);
  const example = profile.isExample(paper.id);
  const following = profile.isFollowing(paper.journal);
  const doiUrl = paper.doi ? `https://doi.org/${paper.doi}` : undefined;
  const pdfIsFile = !!paper.pdfUrl && (/\.pdf($|\?)/i.test(paper.pdfUrl) || /arxiv\.org\/pdf/.test(paper.pdfUrl));
  const checkboxId = `select-${paper.id}`;

  return (
    <article className={`card${selected ? ' card-selected' : ''}`}>
      <div className="card-side">
        <input
          id={checkboxId}
          type="checkbox"
          className="checkbox"
          checked={selected}
          onChange={() => selection.toggle(paper)}
          aria-label={`Select “${paper.title}”`}
        />
        {showScore && (
          <button
            className={`score score-${scoreTier(score)}`}
            onClick={() => setShowWhy((v) => !v)}
            title="Relevance to your profile — click for the breakdown"
            aria-expanded={showWhy}
          >
            <span className="score-value">{score}%</span>
            <span className="score-label">match</span>
          </button>
        )}
      </div>

      <div className="card-body">
        <h3 className="card-title">
          {paper.url ? <a href={paper.url} target="_blank" rel="noopener noreferrer">{paper.title}</a> : paper.title}
        </h3>

        <p className="card-authors">
          {allAuthors ? paper.authors.map((a) => a.name).join(', ') : formatAuthors(paper.authors)}
          {paper.authors.length > 4 && (
            <button className="link-btn" onClick={() => setAllAuthors((v) => !v)}>{allAuthors ? 'show fewer' : 'show all'}</button>
          )}
        </p>

        <p className="card-meta">
          {paper.journal && (
            <span className={following ? 'journal journal-followed' : 'journal'} title={following ? 'You follow this journal' : undefined}>
              {following && '★ '}{paper.journal}
            </span>
          )}
          <QuartileBadge journal={journalOf(paper)} />
          <span>{formatDate(paper.publicationDate)}</span>
          {paper.documentType && paper.documentType !== 'article' && <span className="tag">{DOCUMENT_TYPE_LABELS[paper.documentType]}</span>}
          {paper.openAccess && <span className="tag tag-oa">Open access</span>}
          {paper.citationCount !== undefined && paper.citationCount > 0 && <span>{paper.citationCount.toLocaleString()} citations</span>}
          <span className="sources" title="Databases that returned this record">{paper.sources.map((s) => SOURCE_LABELS[s]).join(' · ')}</span>
        </p>

        {note && <p className="card-note">{note}</p>}

        {showScore && reasons.length > 0 && (
          <div className="why">
            <span className="why-label">Why recommended</span>
            {reasons.slice(0, showWhy ? reasons.length : 3).map((r) => (
              <span key={r.text} className={`reason reason-${r.strength}`}>{r.text}</span>
            ))}
            {!showWhy && reasons.length > 3 && <button className="link-btn" onClick={() => setShowWhy(true)}>+{reasons.length - 3} more</button>}
          </div>
        )}

        {showWhy && showScore && (
          <div className="breakdown">
            {breakdown.map((b) => (
              <div key={b.signal} className="breakdown-row">
                <span className="breakdown-label">{b.label}{b.bonus && ' (bonus)'}</span>
                <span className="bar" role="img" aria-label={`${Math.round(b.points)} of ${Math.round(b.maxPoints)} points`}>
                  <span className="bar-fill" style={{ width: `${Math.round(b.score * 100)}%` }} />
                </span>
                <span className="breakdown-points">{b.bonus && '+'}{Math.round(b.points)} / {Math.round(b.maxPoints)}</span>
              </div>
            ))}
            {matchedTopics.length > 0 && <p className="breakdown-note">Matched topics: {matchedTopics.join(' · ')}</p>}
          </div>
        )}

        {paper.abstract ? (
          <p className={showAbstract ? 'abstract' : 'abstract abstract-clamped'}>{paper.abstract}</p>
        ) : (
          <p className="abstract abstract-missing">No abstract available from the indexed sources.</p>
        )}
        {showAbstract && paper.keywords && paper.keywords.length > 0 && (
          <p className="keywords">{paper.keywords.map((k) => <span key={k} className="tag">{k}</span>)}</p>
        )}

        <div className="card-actions">
          {paper.abstract && (
            <button className="btn btn-small" onClick={() => setShowAbstract((v) => !v)} aria-expanded={showAbstract}>
              {showAbstract ? 'Hide abstract' : 'Abstract'}
            </button>
          )}
          {doiUrl && <a className="btn btn-small" href={doiUrl} target="_blank" rel="noopener noreferrer" title={paper.doi}>DOI</a>}
          {paper.pdfUrl && (
            <a className="btn btn-small" href={paper.pdfUrl} target="_blank" rel="noopener noreferrer">{pdfIsFile ? 'PDF' : 'Open access'}</a>
          )}
          {paper.url && paper.url !== doiUrl && !paper.arxivId && (
            <a className="btn btn-small" href={paper.url} target="_blank" rel="noopener noreferrer">Publisher</a>
          )}
          {paper.semanticScholarId && (
            <a className="btn btn-small" href={`https://www.semanticscholar.org/paper/${paper.semanticScholarId}`} target="_blank" rel="noopener noreferrer">
              Semantic Scholar
            </a>
          )}
          {paper.arxivId && (
            <a className="btn btn-small" href={`https://arxiv.org/abs/${paper.arxivId}`} target="_blank" rel="noopener noreferrer">arXiv</a>
          )}
          <span className="spacer" />
          <button className={`btn btn-small${saved ? ' btn-on' : ''}`} onClick={() => profile.toggleSaved(paper)} aria-pressed={saved}>
            {saved ? '★ Saved' : '☆ Save'}
          </button>
          <button
            className={`btn btn-small${example ? ' btn-on' : ''}`}
            onClick={() => (example ? profile.removeExample(paper.id) : profile.addExample(paper))}
            aria-pressed={example}
            title="Example papers teach PaperScout what you are interested in"
          >
            {example ? '✓ Example paper' : 'More like this'}
          </button>
          <label className={`btn btn-small${selected ? ' btn-on' : ''}`} htmlFor={checkboxId}>{selected ? '✓ Selected' : 'Select'}</label>
          <button className="btn btn-small btn-ghost" onClick={() => profile.dismiss(paper.id)} title="Hide this paper from all feeds">Dismiss</button>
        </div>
      </div>
    </article>
  );
}

export const PaperCard = memo(PaperCardImpl);
