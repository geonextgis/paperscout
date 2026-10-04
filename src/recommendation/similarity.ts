/**
 * Paper-to-paper similarity.
 *
 * `SimilarityProvider` is the seam for semantic search: the default
 * implementation is TF-IDF cosine similarity computed in the browser, but an
 * embedding-based provider (vectors precomputed by the pipeline and shipped as
 * a data file, or computed with an in-browser model) can be dropped in without
 * touching the signals or the UI — see ARCHITECTURE.md § Recommendation engine.
 */
import type { Paper } from '../types/paper';
import { tokenize } from './text';

export interface SimilarityProvider {
  /** Similarity in [0, 1]; 1 = identical content. */
  similarity(a: Paper, b: Paper): number;
}

type Vector = Map<string, number>;

const TITLE_WEIGHT = 3;
const KEYWORD_WEIGHT = 2;

function termCounts(paper: Paper): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (text: string | undefined, weight: number) => {
    for (const t of tokenize(text)) counts.set(t, (counts.get(t) ?? 0) + weight);
  };
  add(paper.title, TITLE_WEIGHT);
  add(paper.keywords?.join(' '), KEYWORD_WEIGHT);
  add(paper.abstract, 1);
  return counts;
}

export class TfidfSimilarity implements SimilarityProvider {
  private readonly idf = new Map<string, number>();
  private readonly defaultIdf: number;
  private readonly vectors = new WeakMap<Paper, Vector>();

  /** @param corpus papers used to estimate how informative each term is. */
  constructor(corpus: Paper[]) {
    const df = new Map<string, number>();
    for (const paper of corpus) for (const term of termCounts(paper).keys()) df.set(term, (df.get(term) ?? 0) + 1);
    const n = Math.max(corpus.length, 1);
    for (const [term, count] of df) this.idf.set(term, Math.log(1 + n / count));
    this.defaultIdf = Math.log(1 + n); // unseen terms are maximally informative
  }

  private vector(paper: Paper): Vector {
    let v = this.vectors.get(paper);
    if (v) return v;
    v = new Map();
    let norm = 0;
    for (const [term, count] of termCounts(paper)) {
      const w = (1 + Math.log(count)) * (this.idf.get(term) ?? this.defaultIdf);
      v.set(term, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [term, w] of v) v.set(term, w / norm);
    this.vectors.set(paper, v);
    return v;
  }

  similarity(a: Paper, b: Paper): number {
    let [small, large] = [this.vector(a), this.vector(b)];
    if (small.size > large.size) [small, large] = [large, small];
    let dot = 0;
    for (const [term, w] of small) {
      const other = large.get(term);
      if (other) dot += w * other;
    }
    return Math.min(1, dot);
  }
}

export interface SimilarPaper {
  paper: Paper;
  similarity: number;
  /** The reference paper it is most similar to. */
  reference: Paper;
}

/** Candidates most similar to any of the reference papers (used for "Related to saved papers"). */
export function findSimilar(
  provider: SimilarityProvider,
  references: Paper[],
  candidates: Paper[],
  limit: number,
  minSimilarity = 0.12,
): SimilarPaper[] {
  if (!references.length) return [];
  const refIds = new Set(references.map((r) => r.id));
  const out: SimilarPaper[] = [];
  for (const paper of candidates) {
    if (refIds.has(paper.id)) continue;
    let best = 0;
    let reference = references[0];
    for (const ref of references) {
      const s = provider.similarity(paper, ref);
      if (s > best) (best = s), (reference = ref);
    }
    if (best >= minSimilarity) out.push({ paper, similarity: best, reference });
  }
  return out.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
