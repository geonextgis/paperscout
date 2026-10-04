import type { DocumentType, Paper, SourceId } from './paper';

export interface FollowedJournal {
  name: string;
  issn?: string[];
}

export type SortOrder = 'relevance' | 'newest' | 'citations';

export interface PaperFilters {
  /** Only papers published within the last N days. 0 = any time. */
  maxAgeDays: number;
  journals: string[];
  sources: SourceId[];
  documentTypes: DocumentType[];
  openAccessOnly: boolean;
  followedJournalsOnly: boolean;
  minCitations: number;
  /** Minimum relevance, 0–100. */
  minRelevance: number;
  sort: SortOrder;
}

export const DEFAULT_FILTERS: PaperFilters = {
  maxAgeDays: 0,
  journals: [],
  sources: [],
  documentTypes: [],
  openAccessOnly: false,
  followedJournalsOnly: false,
  minCitations: 0,
  minRelevance: 0,
  sort: 'relevance',
};

/** Relative importance of each ranking signal. See `src/recommendation`. */
export interface SignalWeights {
  topics: number;
  examples: number;
  journal: number;
  authors: number;
  recency: number;
  citations: number;
}

export const DEFAULT_WEIGHTS: SignalWeights = {
  topics: 40,
  examples: 25,
  journal: 12,
  authors: 8,
  recency: 10,
  citations: 5,
};

/**
 * Everything PaperScout knows about one researcher.
 *
 * Papers are stored in full (not just ids) so that saved and example papers
 * survive after the pipeline prunes them from the rolling catalogue.
 */
export interface UserProfile {
  version: 1;
  onboarded: boolean;
  topics: string[];
  journals: FollowedJournal[];
  authors: string[];
  examplePapers: Paper[];
  savedPapers: Paper[];
  dismissedIds: string[];
  filters: PaperFilters;
  weights: SignalWeights;
  /** Papers fetched on demand from Crossref for this profile (see `liveFetch.ts`). */
  extraPapers: Paper[];
  extraFetchedAt?: string;
  theme: 'system' | 'light' | 'dark';
}

export const EMPTY_PROFILE: UserProfile = {
  version: 1,
  onboarded: false,
  topics: [],
  journals: [],
  authors: [],
  examplePapers: [],
  savedPapers: [],
  dismissedIds: [],
  filters: DEFAULT_FILTERS,
  weights: DEFAULT_WEIGHTS,
  extraPapers: [],
  theme: 'system',
};
