import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PaperList } from '../components/PaperList';
import { ageInDays, findSimilar, journalMatcher, type ScoredPaper } from '../recommendation';
import { truncate } from '../recommendation/signals';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import { sortScored } from '../utils/filter';

interface Section {
  id: string;
  title: string;
  description: string;
  items: ScoredPaper[];
  notes?: Map<string, string>;
  empty: ReactNode;
}

const HIGHLY_RELEVANT = 70;

export function ForYouPage() {
  const { scored, ranker, now, loading, personalized, meta } = useLibrary();
  const { profile, removeTopic, unfollowJournal } = useProfile();

  const sections = useMemo<Section[]>(() => {
    const isFollowed = journalMatcher(profile.journals);
    const relevant = scored.filter((s) => s.score >= HIGHLY_RELEVANT);
    const week = scored.filter((s) => (ageInDays(s.paper, now) ?? 999) <= 7);
    const related = findSimilar(ranker.similarity, profile.savedPapers, scored.map((s) => s.paper), 30);
    const byId = new Map(scored.map((s) => [s.paper.id, s]));

    return [
      {
        id: 'highly-relevant',
        title: 'Highly relevant',
        description: `Papers scoring ${HIGHLY_RELEVANT}% or more against your profile.`,
        items: relevant,
        empty: personalized
          ? 'Nothing above 70% right now. Add more topics or example papers to sharpen the ranking.'
          : 'Add research topics to get relevance scores.',
      },
      {
        id: 'for-you',
        title: 'For you',
        description: 'More papers that match your profile, best first.',
        items: scored.filter((s) => s.score < HIGHLY_RELEVANT && s.score >= 25),
        empty: 'No further matches.',
      },
      {
        id: 'new-this-week',
        title: 'New this week',
        description: 'Published in the last 7 days, most relevant first.',
        items: week,
        empty: 'No papers from the last 7 days in the catalogue.',
      },
      {
        id: 'preferred-journals',
        title: 'From journals you follow',
        description: 'The latest papers from your followed journals.',
        items: sortScored(scored.filter((s) => isFollowed(s.paper)), 'newest'),
        empty: <>You are not following any journals with recent papers. <Link to="/journals">Follow journals</Link>.</>,
      },
      {
        id: 'trending',
        title: 'Trending',
        description: 'Recent papers that are already being cited.',
        items: sortScored(scored.filter((s) => (s.paper.citationCount ?? 0) > 0), 'citations').slice(0, 30),
        empty: 'No citation data yet for recent papers.',
      },
      {
        id: 'related-to-saved',
        title: 'Related to saved papers',
        description: 'Papers similar in content to the ones you bookmarked.',
        items: related.map((r) => byId.get(r.paper.id)!).filter(Boolean),
        notes: new Map(related.map((r) => [r.paper.id, `Similar to your saved paper “${truncate(r.reference.title, 80)}”`])),
        empty: 'Save a few papers and similar ones will appear here.',
      },
    ];
  }, [scored, ranker, now, profile.journals, profile.savedPapers, personalized]);

  if (loading) return <div className="empty">Loading the catalogue…</div>;

  return (
    <>
      <section className="profile-summary">
        <div className="summary-row">
          <h2>Your interests</h2>
          <div className="chips">
            {profile.topics.map((t) => (
              <span key={t} className="chip chip-on">{t}<button className="chip-x" aria-label={`Remove ${t}`} onClick={() => removeTopic(t)}>×</button></span>
            ))}
            <Link className="chip chip-toggle" to="/settings#topics">+ Add</Link>
          </div>
        </div>
        <div className="summary-row">
          <h2>Following journals</h2>
          <div className="chips">
            {profile.journals.map((j) => (
              <span key={j.name} className="chip chip-on">{j.name}<button className="chip-x" aria-label={`Unfollow ${j.name}`} onClick={() => unfollowJournal(j.name)}>×</button></span>
            ))}
            <Link className="chip chip-toggle" to="/journals">+ Add</Link>
          </div>
        </div>
        {(profile.examplePapers.length > 0 || profile.authors.length > 0) && (
          <p className="muted">
            Also ranking by {[
              profile.examplePapers.length > 0 && `${profile.examplePapers.length} example paper${profile.examplePapers.length === 1 ? '' : 's'}`,
              profile.authors.length > 0 && `${profile.authors.length} followed author${profile.authors.length === 1 ? '' : 's'}`,
            ].filter(Boolean).join(' and ')}. <Link to="/settings">Edit profile</Link>
          </p>
        )}
      </section>

      {!personalized && (
        <div className="notice">
          <strong>Welcome to PaperScout.</strong> Tell it what you work on and the feed below becomes a ranked, explained list.{' '}
          <Link to="/welcome">Set up your profile</Link>
        </div>
      )}
      {!meta && (
        <div className="notice">
          The catalogue has not been built yet. Run the <em>Update papers</em> workflow (or <code>npm run fetch-papers</code>) to populate it.
        </div>
      )}

      <nav className="jump" aria-label="Sections">
        {sections.map((s) => (
          <a key={s.id} className="chip chip-toggle" href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }); }}>
            {s.title} <span className="muted">{s.items.length}</span>
          </a>
        ))}
      </nav>

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="feed-section">
          <div className="section-head">
            <h2>{s.title}</h2>
            <p className="muted">{s.description}</p>
          </div>
          <PaperList items={s.items} pageSize={4} empty={s.empty} notes={s.notes} />
        </section>
      ))}
    </>
  );
}
