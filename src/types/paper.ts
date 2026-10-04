/**
 * Common metadata schema.
 *
 * Every scholarly source is normalized into `Paper` before it reaches the
 * catalogue, the recommendation engine or the exporters. Nothing downstream
 * should ever need to know which API a record came from.
 */

export type SourceId = 'wos' | 'crossref' | 'semanticscholar' | 'arxiv';

export const SOURCE_LABELS: Record<SourceId, string> = {
  wos: 'Web of Science',
  crossref: 'Crossref',
  semanticscholar: 'Semantic Scholar',
  arxiv: 'arXiv',
};

export type DocumentType =
  | 'article'
  | 'review'
  | 'preprint'
  | 'conference'
  | 'book-chapter'
  | 'book'
  | 'dataset'
  | 'editorial'
  | 'other';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  article: 'Article',
  review: 'Review',
  preprint: 'Preprint',
  conference: 'Conference paper',
  'book-chapter': 'Book chapter',
  book: 'Book',
  dataset: 'Dataset',
  editorial: 'Editorial',
  other: 'Other',
};

export interface Author {
  /** Display name, "Given Family". Always present. */
  name: string;
  given?: string;
  family?: string;
  orcid?: string;
  affiliation?: string;
}

export interface Paper {
  /** Stable identifier: `doi:…`, `arxiv:…`, `wos:…`, `s2:…` or `title:…` (hash). */
  id: string;
  title: string;
  abstract?: string;
  authors: Author[];

  /** Journal, conference or preprint server name. */
  journal?: string;
  issn?: string[];
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  documentType?: DocumentType;

  /** ISO date, possibly partial: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  publicationDate?: string;
  year?: number;

  /** Lower-case, without resolver prefix. */
  doi?: string;
  /** Landing page (publisher). */
  url?: string;
  /** Direct open-access full text, when known. */
  pdfUrl?: string;
  openAccess?: boolean;
  citationCount?: number;

  keywords?: string[];
  fieldsOfStudy?: string[];

  /** Every database that returned this record. */
  sources: SourceId[];
  webOfScienceId?: string;
  webOfScienceUrl?: string;
  semanticScholarId?: string;
  arxivId?: string;

  /** ISO timestamp of when the pipeline first added the paper to the catalogue. */
  firstSeen?: string;
}

/** `public/data/journals.json` */
export interface JournalInfo {
  name: string;
  issn?: string[];
  publisher?: string;
  /** Papers currently in the catalogue. */
  paperCount: number;
  /** True when the journal is tracked explicitly in `config/pipeline.config.json`. */
  tracked?: boolean;
}

export interface SourceRunStatus {
  source: SourceId;
  status: 'ok' | 'partial' | 'skipped' | 'failed';
  fetched: number;
  requests: number;
  message?: string;
}

/** `public/data/last_updated.json` */
export interface CatalogueMeta {
  updatedAt: string;
  paperCount: number;
  journalCount: number;
  lookbackDays: number;
  topics: string[];
  sources: SourceRunStatus[];
}
