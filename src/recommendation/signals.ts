/**
 * Ranking signals. Each signal looks at one aspect of a paper and returns a
 * score in [0, 1] plus human-readable reasons. The engine combines them with
 * the user's weights. Adding a signal = adding one object to `SIGNALS`.
 */
import type { Author, Paper } from '../types/paper';
import type { SignalWeights, UserProfile } from '../types/profile';
import { dateToTime, journalKey, stripDiacritics } from '../utils/normalize';
import type { SimilarityProvider } from './similarity';
import { phraseText, tokenize } from './text';

export type ReasonStrength = 'strong' | 'medium' | 'weak';

export interface Reason {
  signal: keyof SignalWeights;
  text: string;
  strength: ReasonStrength;
}

export interface SignalResult {
  score: number;
  reasons: Reason[];
  matchedTopics?: string[];
}

export interface RankingContext {
  profile: UserProfile;
  similarity: SimilarityProvider;
  now: number;
}

export interface Signal {
  id: keyof SignalWeights;
  label: string;
  /**
   * Core signals define the 100-point scale. Bonus signals fire rarely (a
   * followed author, an already-cited paper, a close match to an example
   * paper): they add points on top but are not part of the scale, so a paper
   * is never marked down for lacking them.
   */
  isCore(profile: UserProfile): boolean;
  /** Inactive signals are left out of the weighted average instead of counting as zero. */
  isActive(profile: UserProfile): boolean;
  /** Called once per ranking run; returns the per-paper evaluator. */
  prepare(ctx: RankingContext): (paper: Paper) => SignalResult;
}

const NONE: SignalResult = { score: 0, reasons: [] };
const DAY = 86_400_000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// --- topics -----------------------------------------------------------------

interface PaperText { title: string; keywords: string; abstract: string; all: Set<string>; titleSet: Set<string> }
const paperTextCache = new WeakMap<Paper, PaperText>();

function paperText(paper: Paper): PaperText {
  let t = paperTextCache.get(paper);
  if (!t) {
    const title = tokenize(paper.title);
    const keywords = tokenize([...(paper.keywords ?? []), ...(paper.fieldsOfStudy ?? [])].join(' . '));
    const abstract = tokenize(paper.abstract);
    t = {
      title: phraseText(title),
      keywords: phraseText(keywords),
      abstract: phraseText(abstract),
      all: new Set([...title, ...keywords, ...abstract]),
      titleSet: new Set(title),
    };
    paperTextCache.set(paper, t);
  }
  return t;
}

/** How strongly a topic phrase matches a paper, 0–1. Exported for the search page. */
export function topicStrength(topicTokens: string[], paper: Paper): number {
  if (!topicTokens.length) return 0;
  const text = paperText(paper);
  const phrase = phraseText(topicTokens);
  if (text.title.includes(phrase)) return 1;
  if (text.keywords.includes(phrase)) return 0.9;
  if (text.abstract.includes(phrase)) return 0.75;
  if (topicTokens.every((t) => text.titleSet.has(t))) return 0.7;
  const present = topicTokens.filter((t) => text.all.has(t)).length;
  if (present === topicTokens.length) return 0.5;
  const fraction = present / topicTokens.length;
  return topicTokens.length >= 2 && fraction >= 0.5 ? 0.25 * fraction : 0;
}

const topicsSignal: Signal = {
  id: 'topics',
  isCore: () => true,
  label: 'Research topics',
  isActive: (p) => p.topics.length > 0,
  prepare: ({ profile }) => {
    const topics = profile.topics.map((topic) => ({ topic, tokens: tokenize(topic) }));
    return (paper) => {
      const hits = topics
        .map(({ topic, tokens }) => ({ topic, strength: topicStrength(tokens, paper) }))
        .filter((h) => h.strength >= 0.25)
        .sort((a, b) => b.strength - a.strength);
      if (!hits.length) return NONE;
      // Noisy-OR: one strong match already scores high, further matches add with diminishing returns.
      const score = 1 - hits.reduce((acc, h) => acc * (1 - 0.9 * h.strength), 1);
      return {
        score,
        matchedTopics: hits.filter((h) => h.strength >= 0.5).map((h) => h.topic),
        reasons: hits.slice(0, 4).map((h) => ({
          signal: 'topics',
          strength: h.strength >= 0.75 ? 'strong' : h.strength >= 0.5 ? 'medium' : 'weak',
          text: `${h.strength >= 0.75 ? 'Strong match' : h.strength >= 0.5 ? 'Match' : 'Partial match'}: ${h.topic}`,
        })),
      };
    };
  },
};

// --- example papers -----------------------------------------------------------

/** TF-IDF cosine of ~0.3 already means "clearly the same line of research". */
const SIMILARITY_SATURATION = 0.3;

const examplesSignal: Signal = {
  id: 'examples',
  // a second route to relevance next to topics; the main one without topics
  isCore: (p) => p.topics.length === 0,
  label: 'Similarity to example papers',
  isActive: (p) => p.examplePapers.length > 0,
  prepare: ({ profile, similarity }) => (paper) => {
    let best = 0;
    let bestExample: Paper | undefined;
    for (const example of profile.examplePapers) {
      if (example.id === paper.id) continue;
      const s = similarity.similarity(paper, example);
      if (s > best) (best = s), (bestExample = example);
    }
    if (!bestExample || best < 0.08) return NONE;
    return {
      score: clamp01(best / SIMILARITY_SATURATION),
      reasons: [{
        signal: 'examples',
        strength: best >= 0.25 ? 'strong' : best >= 0.15 ? 'medium' : 'weak',
        text: `${best >= 0.25 ? 'Very similar' : 'Similar'} to “${truncate(bestExample.title)}”`,
      }],
    };
  },
};

// --- journals -----------------------------------------------------------------

export function journalMatcher(journals: { name: string; issn?: string[] }[]): (paper: Paper) => boolean {
  const names = new Set(journals.map((j) => journalKey(j.name)).filter(Boolean));
  const issns = new Set(journals.flatMap((j) => j.issn ?? []));
  return (paper) =>
    (!!paper.journal && names.has(journalKey(paper.journal))) || (paper.issn?.some((i) => issns.has(i)) ?? false);
}

const journalSignal: Signal = {
  id: 'journal',
  isCore: () => true,
  label: 'Preferred journals',
  isActive: (p) => p.journals.length > 0 || p.examplePapers.length > 0,
  prepare: ({ profile }) => {
    const followed = journalMatcher(profile.journals);
    const exampleJournals = journalMatcher(
      profile.examplePapers.filter((p) => p.journal && p.journal !== 'arXiv').map((p) => ({ name: p.journal!, issn: p.issn })),
    );
    return (paper) => {
      if (followed(paper))
        return { score: 1, reasons: [{ signal: 'journal', strength: 'strong', text: `Published in followed journal: ${paper.journal}` }] };
      if (exampleJournals(paper))
        return { score: 0.5, reasons: [{ signal: 'journal', strength: 'weak', text: 'Same journal as one of your example papers' }] };
      return NONE;
    };
  },
};

// --- authors ------------------------------------------------------------------

/** "Müller, Hans Peter" and "H. Muller" → "muller h" */
export function authorKey(author: Author | string): string {
  const a = typeof author === 'string' ? { name: author } : author;
  const clean = (s: string) => stripDiacritics(s).toLowerCase().replace(/[^a-z\s-]/g, '').trim();
  let family = a.family ? clean(a.family) : '';
  let given = 'given' in a && a.given ? clean(a.given) : '';
  if (!family) {
    const name = a.name.includes(',') ? a.name.split(',').reverse().join(' ') : a.name;
    const parts = clean(name).split(/\s+/).filter(Boolean);
    family = parts.pop() ?? '';
    given = parts.join(' ');
  }
  return `${family} ${given.charAt(0)}`.trim();
}

const authorsSignal: Signal = {
  id: 'authors',
  isCore: () => false,
  label: 'Authors',
  isActive: (p) => p.authors.length > 0 || p.examplePapers.length > 0,
  prepare: ({ profile }) => {
    const followed = new Set(profile.authors.map(authorKey));
    const fromExamples = new Set(profile.examplePapers.flatMap((p) => p.authors.map(authorKey)));
    return (paper) => {
      let shared: Author | undefined;
      for (const author of paper.authors) {
        const key = authorKey(author);
        if (!key.includes(' ')) continue; // family name only is too ambiguous
        if (followed.has(key))
          return { score: 1, reasons: [{ signal: 'authors', strength: 'strong', text: `By followed author ${author.name}` }] };
        if (!shared && fromExamples.has(key)) shared = author;
      }
      return shared
        ? { score: 0.7, reasons: [{ signal: 'authors', strength: 'medium', text: `${shared.name} also authored one of your example papers` }] }
        : NONE;
    };
  },
};

// --- recency & citations ------------------------------------------------------

export function ageInDays(paper: Paper, now: number): number | undefined {
  const t = dateToTime(paper.publicationDate);
  return t === undefined ? undefined : Math.max(0, Math.floor((now - t) / DAY));
}

export function describeAge(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

const recencySignal: Signal = {
  id: 'recency',
  isCore: () => true,
  label: 'Recency',
  isActive: () => true,
  prepare: ({ now }) => (paper) => {
    const age = ageInDays(paper, now);
    if (age === undefined) return NONE;
    // Day-precision dates only — "2026-09" would otherwise read as "published on the 1st".
    const precise = (paper.publicationDate?.length ?? 0) >= 10;
    return {
      score: Math.exp(-age / 30),
      reasons: age <= 14 && precise ? [{ signal: 'recency', strength: age <= 3 ? 'medium' : 'weak', text: `Published ${describeAge(age)}` }] : [],
    };
  },
};

const citationsSignal: Signal = {
  id: 'citations',
  isCore: () => false,
  label: 'Citations',
  isActive: () => true,
  prepare: () => (paper) => {
    const c = paper.citationCount ?? 0;
    if (c <= 0) return NONE;
    return {
      score: clamp01(Math.log1p(c) / Math.log1p(50)),
      reasons: c >= 5 ? [{ signal: 'citations', strength: 'weak', text: `Cited ${c} times` }] : [],
    };
  },
};

export const SIGNALS: Signal[] = [topicsSignal, examplesSignal, journalSignal, authorsSignal, recencySignal, citationsSignal];
