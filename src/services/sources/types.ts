import type { Paper, SourceId } from '../../types/paper';

export interface JournalQuery {
  name: string;
  issn?: string[];
}

/** What the pipeline asks every source for. */
export interface FetchRequest {
  /** Free-text topic phrases, e.g. "crop modelling". */
  topics: string[];
  /** Journals to pull *all* recent papers from, regardless of topic. */
  journals: JournalQuery[];
  /** Only papers published on/after this date (YYYY-MM-DD). */
  fromDate: string;
  /** Upper bound per topic / per journal query. */
  maxPerQuery: number;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface FetchResult {
  papers: Paper[];
  requests: number;
  /** Non-fatal problems (a failed query, an exhausted quota…). */
  warnings: string[];
}

/**
 * A scholarly database. Implementations receive credentials through their
 * constructor/factory — they never read the environment themselves, which keeps
 * the secret-handling in one place (`scripts/fetch-papers.ts`).
 */
export interface PaperSource {
  readonly id: SourceId;
  /** False when required credentials are missing; the pipeline then skips the source. */
  isConfigured(): boolean;
  /** Human-readable hint shown when the source is skipped. */
  readonly setupHint?: string;
  fetchRecent(request: FetchRequest, log: Logger): Promise<FetchResult>;
}
