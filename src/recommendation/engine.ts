/**
 * Transparent relevance ranking.
 *
 *   score = 100 × Σ(weightᵢ × signalᵢ) / Σ(weightᵢ of active core signals)   (capped at 100)
 *
 * Every signal is in [0, 1]. Core signals (topics, followed journals, recency)
 * define the scale; bonus signals (example-paper similarity, authors,
 * citations) add points on top. The result is a 0–100 % match with a per-signal breakdown
 * that the UI shows. No network calls, no paid APIs.
 */
import type { Paper } from '../types/paper';
import { DEFAULT_WEIGHTS, type SignalWeights, type UserProfile } from '../types/profile';
import { SIGNALS, type Reason, type Signal } from './signals';
import { TfidfSimilarity, type SimilarityProvider } from './similarity';

export interface SignalBreakdown {
  signal: keyof SignalWeights;
  label: string;
  /** Raw signal value, 0–1. */
  score: number;
  /** Points this signal can contribute at most. */
  maxPoints: number;
  /** Bonus signals add on top of the 100-point scale. */
  bonus: boolean;
  /** Points actually contributed. */
  points: number;
}

export interface ScoredPaper {
  paper: Paper;
  /** 0–100. */
  score: number;
  reasons: Reason[];
  matchedTopics: string[];
  breakdown: SignalBreakdown[];
}

export interface RankerOptions {
  similarity?: SimilarityProvider;
  signals?: Signal[];
  now?: number;
}

export interface Ranker {
  score(paper: Paper): ScoredPaper;
  /** Scores and sorts, best first. */
  rank(papers: Paper[]): ScoredPaper[];
  readonly similarity: SimilarityProvider;
}

const STRENGTH_ORDER = { strong: 0, medium: 1, weak: 2 } as const;

/**
 * @param corpus the papers the similarity model is fitted on (normally the catalogue).
 */
export function createRanker(profile: UserProfile, corpus: Paper[], options: RankerOptions = {}): Ranker {
  const similarity = options.similarity ?? new TfidfSimilarity([...corpus, ...profile.examplePapers]);
  const ctx = { profile, similarity, now: options.now ?? Date.now() };
  const weights = { ...DEFAULT_WEIGHTS, ...profile.weights };

  const active = (options.signals ?? SIGNALS)
    .filter((s) => weights[s.id] > 0 && s.isActive(profile))
    .map((s) => ({ signal: s, weight: weights[s.id], core: s.isCore(profile), evaluate: s.prepare(ctx) }));
  const totalWeight = active.reduce((sum, s) => sum + (s.core ? s.weight : 0), 0) || 1;

  const score = (paper: Paper): ScoredPaper => {
    const reasons: Reason[] = [];
    const matchedTopics: string[] = [];
    let points = 0;
    const breakdown = active.map(({ signal, weight, core, evaluate }) => {
      const result = evaluate(paper);
      const maxPoints = (100 * weight) / totalWeight;
      const contribution = maxPoints * result.score;
      points += contribution;
      reasons.push(...result.reasons);
      if (result.matchedTopics) matchedTopics.push(...result.matchedTopics);
      return { signal: signal.id, label: signal.label, score: result.score, maxPoints, points: contribution, bonus: !core };
    });
    reasons.sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength]);
    return { paper, score: Math.round(Math.min(100, points)), reasons, matchedTopics, breakdown };
  };

  return {
    similarity,
    score,
    rank: (papers) => papers.map(score).sort((a, b) => b.score - a.score),
  };
}
