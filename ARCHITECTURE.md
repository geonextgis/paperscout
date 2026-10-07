# PaperScout — Architecture

PaperScout is a personalized literature feed that runs without a server:

```text
                    ┌──────────────── GitHub Actions (daily) ────────────────┐
 Crossref ────────▶ │  fetch → normalize → deduplicate/merge → enrich → prune │──▶ public/data/*.json
 Semantic Scholar ▶ │        (scripts/fetch-papers.ts, secrets from env)      │        (committed)
 arXiv ───────────▶ │                                                        │            │
 OpenAlex ────────▶ │  journal rankings (Q1–Q4)                               │            │
                    └────────────────────────────────────────────────────────┘            ▼
                                                                              GitHub Pages (static build)
                                                                                           │
                    ┌──────────────────────── Browser ───────────────────────┐            │
                    │ catalogue JSON ─▶ ranking engine ─▶ feeds / search      │◀───────────┘
                    │ profile (localStorage) ─┘            └▶ BibTeX/RIS/CSV  │
                    └────────────────────────────────────────────────────────┘
```

## Design decisions

| Decision | Why |
|---|---|
| **Static site + scheduled pipeline** | Free to host, nothing to operate, trivially forkable. The catalogue is built once a day, so opening the site costs one JSON download and zero API calls. |
| **Ranking happens in the browser** | The catalogue is shared by all visitors; the profile is private. Scoring client-side means no accounts, no backend and no profile data leaving the device. |
| **Credentials only in the pipeline** | `scripts/fetch-papers.ts` is the single place that reads `process.env`. Source clients receive keys through their constructor. No client that needs a secret is imported by the frontend. |
| **One `Paper` schema** | Every source is normalized at the edge (`src/services/sources/*`). Ranking, UI and exporters never branch on the origin of a record. |
| **Rolling catalogue** | The pipeline keeps a window (`retentionDays`, `maxPapers`) so the JSON stays small enough to load on a phone. Saved and example papers are stored *in full* in the profile, so they outlive the window. |
| **`HashRouter` + `base: './'`** | The build works at any path (user site, project site, custom domain, fork with another name) with no configuration and no 404 rewrite trick. |
| **Generated data lives in `public/data/`** | Vite copies `public/` verbatim, so the pipeline output is served next to the app without a build step in between. |

## Repository layout

```text
.github/workflows/
  update-papers.yml     daily pipeline → commits public/data → calls deploy
  deploy.yml            test, build, publish to GitHub Pages
  ci.yml                tests + build on pull requests
config/pipeline.config.json   topics, journals, window sizes (edit this in your fork)
scripts/fetch-papers.ts       pipeline orchestration (Node, the only reader of secrets)
public/data/                  papers.json · journals.json · last_updated.json (generated)
src/
  types/            paper.ts (common schema) · profile.ts (user profile, filters, weights)
  services/
    http.ts         fetch wrapper: rate limiter, timeout, retry/backoff, Retry-After
    sources/        crossref.ts · semanticScholar.ts · arxiv.ts · types.ts
    journalRanking.ts  Q1–Q4 estimate from OpenAlex (pipeline only)
    catalogue.ts    loads public/data in the browser
    liveFetch.ts    optional, user-initiated Crossref supplement
  utils/            normalize.ts · deduplicate.ts · filter.ts (filters + search) · format.ts
  recommendation/   text.ts · similarity.ts · signals.ts · engine.ts
  export/           bibtex.ts · ris.ts · csv.ts · index.ts (download)
  store/            profileStore.ts (persistence boundary) · Profile/Library/Selection contexts
  components/       Layout, PaperCard, PaperList, FilterPanel, SelectionBar, pickers/editors
  pages/            ForYou, Latest, Journals, Search, Saved, Export, Settings, Onboarding
tests/              vitest: exporters, normalization, deduplication, ranking, search
```

## Common metadata schema

Defined in [`src/types/paper.ts`](src/types/paper.ts). Compared with the minimal schema in the brief it adds what
the exporters and the UI need: `issn`, `publisher`, `volume`, `issue`, `pages`, `documentType`
and `firstSeen` (when the pipeline first saw the record).

Conventions: DOIs are lower-case without resolver prefix; dates are ISO and may be partial (`2026`, `2026-10`);
`id` is derived from the best identifier (`doi:` → `arxiv:` → `s2:` → title hash); `sources` lists every
database that returned the record.

## Source layer

Each database implements `PaperSource` ([`src/services/sources/types.ts`](src/services/sources/types.ts)):

```ts
interface PaperSource {
  readonly id: SourceId;
  isConfigured(): boolean;            // false → the pipeline skips it and records why
  fetchRecent(request, log): Promise<{ papers: Paper[]; requests: number; warnings: string[] }>;
}
```

| Source | What it contributes | Auth | Throttle |
|---|---|---|---|
| Crossref | everything recent from tracked journals (by ISSN) + most relevant recent works per topic | none (`mailto` for the polite pool) | ≥ 300 ms between calls |
| Semantic Scholar | topic search, abstracts, citation counts, open-access PDFs; batch **enrichment** of DOIs that lack an abstract | optional `x-api-key` | 1.1 s with key, 3.5 s without |
| arXiv | preprints per topic | none | 3.2 s between calls |

Failure handling is layered: `http.ts` retries transient errors (408/425/429/5xx, network, timeout) with exponential
backoff and `Retry-After`; a failed query becomes a warning and the source continues; a failed source is recorded in
`last_updated.json` and the others continue; only when *every* source fails does the run exit non-zero, leaving the
previous catalogue untouched.

Web of Science was a source in the first version and was removed: without a key it was always skipped, the Starter
API returns no abstracts, and its journal coverage is reached through Crossref. Adding it back means one more
`PaperSource`.

## Pipeline

`scripts/fetch-papers.ts`:

1. Read `config/pipeline.config.json` and the environment.
2. Run all configured sources concurrently (they hit different hosts and rate-limit themselves).
3. Clamp future "issue cover" dates to the day the paper became available.
4. `deduplicate([...existing, ...fetched])` — see below.
5. Enrich abstract-less DOIs through Semantic Scholar's batch endpoint (newest first, `enrichLimit` per run).
6. Prune to `retentionDays` / `maxPapers`, sort newest first.
7. Rank the journals (below); on failure the previous rankings are carried over.
8. Write `papers.json` (one record per line → small git diffs), `journals.json`, `last_updated.json`, and a job summary.

### Deduplication and merging — [`src/utils/deduplicate.ts`](src/utils/deduplicate.ts)

Records are the same paper when they share a DOI, arXiv id or Semantic Scholar id, or when they have the same
normalized title and a compatible first author and year (this joins a preprint with its published version). Two records
with *different publisher DOIs* are never merged by title. Merging is field-wise: bibliographic fields from the most
authoritative source (Crossref → Semantic Scholar → arXiv), the longest abstract, the most precise date, the
publisher DOI over the arXiv DOI, the larger citation count, and the union of keywords, ISSNs and sources.

### Journal ranking — [`src/services/journalRanking.ts`](src/services/journalRanking.ts)

Quartiles are stored per journal in `journals.json` (`quartile`, `impact`, `field`), not per paper; the browser joins
them through `useLibrary().journalOf(paper)` (ISSN first, then normalized name), so saved and live-fetched papers get
a badge too when their journal is in the catalogue.

JCR and SJR quartiles are not openly available, so the value is an estimate from OpenAlex: the journal's 2-year mean
citedness placed among the CWTS-core journals with non-zero citedness that publish in its main field. Per run this
costs one ISSN lookup per 50 journals, one `group_by` for the field sizes, three sorted single-row requests per field
for the quartile boundaries, and one count request per multidisciplinary journal (largest field < ⅓ of its papers),
which is ranked against the whole pool.

## Recommendation engine — [`src/recommendation/`](src/recommendation)

```text
score = 100 × Σ weightᵢ · signalᵢ / Σ weightᵢ(active core signals)        capped at 100
```

| Signal | Kind | Value (0–1) |
|---|---|---|
| Research topics | core | per topic: phrase in title 1.0 · in keywords 0.9 · in abstract 0.75 · all words in title 0.7 · all words anywhere 0.5; topics combine by noisy-OR `1 − Π(1 − 0.9·sᵢ)` |
| Preferred journals | core | followed journal 1.0 · journal of an example paper 0.5 |
| Recency | core | `exp(−age_days / 30)` |
| Example papers | bonus (core when no topics are set) | max TF-IDF cosine similarity to an example paper ÷ 0.3, capped at 1 |
| Authors | bonus | followed author 1.0 · shares an author with an example paper 0.7 |
| Citations | bonus | `log(1 + c) / log(51)` |

Core signals define the 100-point scale; bonus signals fire rarely and add points on top, so a paper is never marked
down for lacking them. Signals the user has not configured are inactive and left out. Each signal returns reasons
("Strong match: crop modelling", "Published in followed journal", "Similar to “…”"), and the per-signal points are shown
in the card's breakdown. Weights are user-adjustable in Settings.

Text matching uses a small stemmer so that *modelling / modeling / models* and *agricultural / agriculture* line up.

**Adding semantic embeddings.** Similarity sits behind one interface:

```ts
interface SimilarityProvider { similarity(a: Paper, b: Paper): number }
```

`TfidfSimilarity` is the default. An embedding provider would (1) compute vectors in the pipeline and write
`public/data/embeddings.bin`, (2) implement `SimilarityProvider` as a dot product over those vectors, and (3) be passed
to `createRanker(profile, papers, { similarity })`. Signals, UI and explanations stay unchanged. New signals (e.g.
👍/👎 feedback) are one more object in `SIGNALS`.

## Frontend state

| Context | Holds | Persistence |
|---|---|---|
| `ProfileContext` | topics, journals, authors, example papers, saved papers, dismissed ids, filters, weights, theme | `ProfileStore` → localStorage |
| `LibraryContext` | catalogue, merged paper list, ranker, scored papers | none (derived) |
| `SelectionContext` | selected papers (full objects, across pages) | none (session) |

**Adding accounts later.** `ProfileStore` ([`src/store/profileStore.ts`](src/store/profileStore.ts)) is an async
`load / save / clear` interface. A Supabase or Firebase implementation replaces `LocalStorageProfileStore` in one line;
components only use `useProfile()`. `migrateProfile()` already validates arbitrary stored/imported data, which is what a
sync layer needs. Shared reading lists, alerts and digests would add tables/functions on that backend plus a scheduled
workflow; none of it requires changes to the paper schema or the ranking engine.

## Export

`src/export/bibtex.ts` de-duplicates by DOI, generates `familyYEARword` keys (ASCII-folded, with `a`, `b`, … suffixes on
collision), escapes LaTeX specials, optionally transliterates accents to LaTeX commands, protects acronyms and proper
nouns with braces, maps document types to `@article / @inproceedings / @incollection / @book / @misc` (arXiv gets
`eprint` fields), omits missing fields, and can cut long author lists with `and others`. RIS and CSV share the same
de-duplication. Files are generated and downloaded entirely in the browser via a `Blob`.
