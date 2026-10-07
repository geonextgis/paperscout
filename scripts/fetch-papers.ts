/**
 * Literature pipeline — run by `.github/workflows/update-papers.yml` once a day
 * (or locally with `npm run fetch-papers`).
 *
 *   query sources → normalize → deduplicate/merge → enrich → prune → rank journals → write JSON
 *
 * This is the ONLY place credentials are read. They come from the environment
 * (GitHub Actions secrets, or a local git-ignored `.env`) and are handed to the
 * source clients; they are never written to the generated data.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogueMeta, JournalInfo, Paper, SourceRunStatus } from '../src/types/paper';
import { SOURCE_LABELS } from '../src/types/paper';
import {
  ArxivSource, CrossrefSource, SemanticScholarSource,
  type FetchRequest, type JournalQuery, type Logger, type PaperSource,
} from '../src/services/sources';
import { rankJournals } from '../src/services/journalRanking';
import { deduplicate } from '../src/utils/deduplicate';
import { dateToTime, journalKey } from '../src/utils/normalize';

interface PipelineConfig {
  /** How far back each run asks the sources for papers. */
  lookbackDays: number;
  /** Papers older than this are dropped from the rolling catalogue. */
  retentionDays: number;
  maxPapers: number;
  maxPerQuery: number;
  /** Max records per run sent to Semantic Scholar for abstract/citation enrichment. */
  enrichLimit: number;
  topics: string[];
  journals: JournalQuery[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(ROOT, 'public/data');
const DAY = 86_400_000;

const log: Logger = {
  info: (m) => console.log(`[info]  ${m}`),
  warn: (m) => console.warn(`[warn]  ${m}`),
  error: (m) => console.error(`[error] ${m}`),
};

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    log.warn(`could not parse ${path}: ${(error as Error).message}`);
    return fallback;
  }
}

/** One record per line: daily commits then produce small, readable diffs. */
function writePapers(path: string, papers: Paper[]): void {
  writeFileSync(path, `[\n${papers.map((p) => JSON.stringify(p)).join(',\n')}\n]\n`);
}

function paperTime(p: Paper): number {
  return dateToTime(p.publicationDate) ?? dateToTime(p.firstSeen) ?? 0;
}

function buildJournals(papers: Paper[], tracked: JournalQuery[]): JournalInfo[] {
  const byKey = new Map<string, JournalInfo>();
  for (const j of tracked)
    byKey.set(journalKey(j.name), { name: j.name, issn: j.issn, paperCount: 0, tracked: true });
  for (const p of papers) {
    const key = journalKey(p.journal);
    if (!key) continue;
    const entry = byKey.get(key) ?? { name: p.journal!, paperCount: 0 };
    entry.paperCount++;
    if (!entry.issn?.length && p.issn?.length) entry.issn = p.issn;
    if (!entry.publisher && p.publisher) entry.publisher = p.publisher;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.paperCount - a.paperCount || a.name.localeCompare(b.name));
}

async function runSource(source: PaperSource, request: FetchRequest): Promise<{ papers: Paper[]; status: SourceRunStatus }> {
  const label = SOURCE_LABELS[source.id];
  if (!source.isConfigured()) {
    log.warn(`${label}: not configured — skipped. ${source.setupHint ?? ''}`);
    return {
      papers: [],
      status: { source: source.id, status: 'skipped', fetched: 0, requests: 0, message: source.setupHint },
    };
  }
  try {
    const started = Date.now();
    const result = await source.fetchRecent(request, log);
    log.info(`${label}: ${result.papers.length} records in ${result.requests} requests (${Math.round((Date.now() - started) / 1000)}s)`);
    return {
      papers: result.papers,
      status: {
        source: source.id,
        status: result.warnings.length ? 'partial' : 'ok',
        fetched: result.papers.length,
        requests: result.requests,
        ...(result.warnings.length && { message: result.warnings.slice(0, 3).join(' | ') }),
      },
    };
  } catch (error) {
    const message = (error as Error).message;
    log.error(`${label}: failed — ${message}`);
    return { papers: [], status: { source: source.id, status: 'failed', fetched: 0, requests: 0, message } };
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(resolve(ROOT, '.env'));
  } catch {
    /* no local .env — fine, CI provides the environment */
  }
  const env = process.env;
  const config = readJson<PipelineConfig | null>(resolve(ROOT, 'config/pipeline.config.json'), null);
  if (!config) throw new Error('config/pipeline.config.json is missing or invalid');

  const now = new Date();
  const request: FetchRequest = {
    topics: config.topics,
    journals: config.journals,
    fromDate: new Date(now.getTime() - config.lookbackDays * DAY).toISOString().slice(0, 10),
    maxPerQuery: config.maxPerQuery,
  };
  log.info(`fetching papers published since ${request.fromDate}: ${config.topics.length} topics, ${config.journals.length} journals`);

  const semanticScholar = new SemanticScholarSource({ apiKey: env.SEMANTIC_SCHOLAR_API_KEY });
  const sources: PaperSource[] = [
    new CrossrefSource({ mailto: env.CROSSREF_MAILTO }),
    semanticScholar,
    new ArxivSource(),
  ];

  // Sources talk to different hosts, so run them concurrently; each one
  // rate-limits itself.
  const results = await Promise.all(sources.map((s) => runSource(s, request)));
  const statuses = results.map((r) => r.status);
  const today = now.toISOString().slice(0, 10);
  const fetched = results
    .flatMap((r) => r.papers)
    // A date in the future is an issue cover date; the paper is available now.
    .map((p) => ({
      ...p,
      ...((p.publicationDate ?? '') > today && { publicationDate: today, year: now.getUTCFullYear() }),
      firstSeen: now.toISOString(),
    }));

  const existing = readJson<Paper[]>(resolve(DATA_DIR, 'papers.json'), []);
  // Existing records first so that `firstSeen` and ids stay stable.
  let papers = deduplicate([...existing, ...fetched]);
  log.info(`catalogue: ${existing.length} existing + ${fetched.length} fetched → ${papers.length} unique`);

  // Enrichment: fill missing abstracts (Crossref often lacks them) from
  // Semantic Scholar, newest papers first.
  const needy = papers
    .filter((p) => p.doi && !p.abstract && !p.doi.startsWith('10.48550/'))
    .sort((a, b) => paperTime(b) - paperTime(a))
    .slice(0, config.enrichLimit)
    .map((p) => p.doi!);
  if (needy.length && statuses.find((s) => s.source === 'semanticscholar')?.status !== 'failed') {
    const enriched = await semanticScholar.enrich(needy, log);
    papers = deduplicate([
      ...papers,
      // Enrichment only adds missing fields; it must not move a paper's date.
      ...enriched.papers.map(({ publicationDate: _d, year: _y, ...rest }) => rest),
    ]);
    const s2 = statuses.find((s) => s.source === 'semanticscholar')!;
    s2.requests += enriched.requests;
    if (enriched.warnings.length) {
      s2.status = 'partial';
      s2.message = [s2.message, ...enriched.warnings].filter(Boolean).slice(0, 3).join(' | ');
    }
  }

  // Prune to a rolling window and a size the browser can load comfortably.
  const cutoff = now.getTime() - config.retentionDays * DAY;
  papers = papers
    .filter((p) => paperTime(p) >= cutoff)
    .sort((a, b) => paperTime(b) - paperTime(a) || a.id.localeCompare(b.id))
    .slice(0, config.maxPapers);

  const allFailed = statuses.every((s) => s.status === 'failed' || s.status === 'skipped');
  if (allFailed && !fetched.length) {
    log.error('every source failed — keeping the previous catalogue untouched');
    process.exitCode = 1;
    return;
  }

  let journals = buildJournals(papers, config.journals);
  let rankedCount: number;
  try {
    const result = await rankJournals(journals, { apiKey: env.OPENALEX_API_KEY, mailto: env.CROSSREF_MAILTO }, log);
    journals = result.journals;
    rankedCount = result.ranked;
    log.info(`journal ranking: ${rankedCount} of ${journals.length} journals ranked in ${result.requests} OpenAlex requests`);
  } catch (error) {
    // Rankings change slowly, so yesterday's are a fine substitute.
    log.warn(`journal ranking failed — keeping the previous rankings. ${(error as Error).message}`);
    const previous = new Map(readJson<JournalInfo[]>(resolve(DATA_DIR, 'journals.json'), []).map((j) => [journalKey(j.name), j]));
    journals = journals.map((j) => {
      const { quartile, impact, field } = previous.get(journalKey(j.name)) ?? {};
      return quartile ? { ...j, quartile, impact, field } : j;
    });
    rankedCount = journals.filter((j) => j.quartile).length;
  }
  const meta: CatalogueMeta = {
    updatedAt: now.toISOString(),
    paperCount: papers.length,
    journalCount: journals.length,
    lookbackDays: config.lookbackDays,
    topics: config.topics,
    sources: statuses,
  };

  mkdirSync(DATA_DIR, { recursive: true });
  writePapers(resolve(DATA_DIR, 'papers.json'), papers);
  writeFileSync(resolve(DATA_DIR, 'journals.json'), JSON.stringify(journals, null, 1) + '\n');
  writeFileSync(resolve(DATA_DIR, 'last_updated.json'), JSON.stringify(meta, null, 2) + '\n');

  const withAbstract = papers.filter((p) => p.abstract).length;
  log.info(`wrote ${papers.length} papers (${withAbstract} with abstracts), ${journals.length} journals → public/data/`);

  if (env.GITHUB_STEP_SUMMARY) {
    const rows = statuses
      .map((s) => `| ${SOURCE_LABELS[s.source]} | ${s.status} | ${s.fetched} | ${s.requests} | ${s.message ?? ''} |`)
      .join('\n');
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `## PaperScout catalogue update\n\n**${papers.length}** papers · **${journals.length}** journals (${rankedCount} ranked Q1–Q4) · ${withAbstract} abstracts\n\n` +
        `| Source | Status | Records | Requests | Notes |\n|---|---|---|---|---|\n${rows}\n`,
    );
  }
}

main().catch((error) => {
  log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
