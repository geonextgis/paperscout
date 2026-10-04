export { createRanker, type Ranker, type ScoredPaper, type SignalBreakdown } from './engine';
export { SIGNALS, ageInDays, describeAge, journalMatcher, authorKey, topicStrength, type Reason, type Signal } from './signals';
export { TfidfSimilarity, findSimilar, type SimilarityProvider, type SimilarPaper } from './similarity';
export { tokenize, stem } from './text';
