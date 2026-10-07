import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRanker, TfidfSimilarity, type Ranker, type ScoredPaper } from '../recommendation';
import { loadCatalogue, type Catalogue } from '../services/catalogue';
import type { CatalogueMeta, JournalInfo, Paper } from '../types/paper';
import { deduplicate } from '../utils/deduplicate';
import { dateToTime, journalKey } from '../utils/normalize';
import { useProfile } from './ProfileContext';

interface LibraryApi {
  loading: boolean;
  error: string | null;
  meta: CatalogueMeta | null;
  journals: JournalInfo[];
  /** Catalogue entry (ranking, publisher…) of the journal a paper appeared in. */
  journalOf(paper: Paper): JournalInfo | undefined;
  /** Catalogue + the user's on-demand Crossref supplement, deduplicated. */
  papers: Paper[];
  /** Every non-dismissed paper, scored against the profile, best first. */
  scored: ScoredPaper[];
  /** Score any paper (saved papers, live search results…) against the profile. */
  score(paper: Paper): ScoredPaper;
  ranker: Ranker;
  /** True when the profile has anything to rank by. */
  personalized: boolean;
  now: number;
}

const LibraryContext = createContext<LibraryApi | null>(null);
const EMPTY: Catalogue = { papers: [], journals: [], meta: null };

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { profile } = useProfile();
  const [catalogue, setCatalogue] = useState<Catalogue>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    loadCatalogue()
      .then(setCatalogue)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const papers = useMemo(
    () => (profile.extraPapers.length ? deduplicate([...catalogue.papers, ...profile.extraPapers]) : catalogue.papers),
    [catalogue.papers, profile.extraPapers],
  );

  // The similarity model is the expensive part; rebuild it only when the corpus changes.
  const similarity = useMemo(
    () => new TfidfSimilarity([...papers, ...profile.examplePapers]),
    [papers, profile.examplePapers],
  );

  const { topics, journals, authors, examplePapers, weights } = profile;
  const ranker = useMemo(
    () => createRanker(profile, papers, { similarity, now }),
    // Saving, dismissing or filtering must not trigger a re-rank.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topics, journals, authors, examplePapers, weights, similarity, now],
  );

  const ranked = useMemo(
    () =>
      ranker
        .rank(papers)
        .sort((a, b) => b.score - a.score || (dateToTime(b.paper.publicationDate) ?? 0) - (dateToTime(a.paper.publicationDate) ?? 0)),
    [ranker, papers],
  );

  const scored = useMemo(() => {
    if (!profile.dismissedIds.length) return ranked;
    const dismissed = new Set(profile.dismissedIds);
    return ranked.filter((s) => !dismissed.has(s.paper.id));
  }, [ranked, profile.dismissedIds]);

  const journalOf = useMemo(() => {
    const index = new Map<string, JournalInfo>();
    for (const j of catalogue.journals) {
      index.set(journalKey(j.name), j);
      for (const issn of j.issn ?? []) index.set(issn, j);
    }
    return (paper: Paper) => paper.issn?.map((i) => index.get(i)).find(Boolean) ?? index.get(journalKey(paper.journal));
  }, [catalogue.journals]);

  const api = useMemo<LibraryApi>(() => {
    const byId = new Map(ranked.map((s) => [s.paper.id, s]));
    return {
      loading, error, papers, scored, ranker, now, journalOf,
      meta: catalogue.meta,
      journals: catalogue.journals,
      score: (paper) => byId.get(paper.id) ?? ranker.score(paper),
      personalized: topics.length + journals.length + authors.length + examplePapers.length > 0,
    };
  }, [loading, error, papers, scored, ranked, ranker, now, catalogue, journalOf, topics, journals, authors, examplePapers]);

  return <LibraryContext.Provider value={api}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return ctx;
}
