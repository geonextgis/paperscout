/**
 * On-demand personal supplement.
 *
 * The shared catalogue only covers the topics and journals configured in
 * `config/pipeline.config.json`. When a visitor follows other journals or
 * topics, this fetches recent matching papers straight from Crossref (public,
 * key-less, CORS-enabled) — only when the user clicks the button, and the
 * result is cached in their profile. Web of Science is never called from the
 * browser.
 */
import type { Paper } from '../types/paper';
import type { UserProfile } from '../types/profile';
import { deduplicate } from '../utils/deduplicate';
import { searchWorks } from './sources/crossref';

const DAY = 86_400_000;
export const LIVE_FETCH_MAX_PAPERS = 400;
const MAX_QUERIES = 16;

export interface LiveFetchProgress {
  done: number;
  total: number;
  label: string;
}

export async function fetchForProfile(
  profile: UserProfile,
  onProgress?: (progress: LiveFetchProgress) => void,
  lookbackDays = 30,
): Promise<{ papers: Paper[]; errors: string[] }> {
  const now = new Date();
  const fromDate = new Date(now.getTime() - lookbackDays * DAY).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const jobs = [
    ...profile.journals
      .filter((j) => j.issn?.length)
      .map((j) => ({ label: j.name, run: () => searchWorks('', { issn: j.issn![0], fromDate, rows: 40, sort: 'published' }) })),
    ...profile.topics.map((t) => ({ label: t, run: () => searchWorks(t, { fromDate, rows: 30 }) })),
  ].slice(0, MAX_QUERIES);

  const papers: Paper[] = [];
  const errors: string[] = [];
  for (const [i, job] of jobs.entries()) {
    onProgress?.({ done: i, total: jobs.length, label: job.label });
    try {
      papers.push(...(await job.run()));
    } catch (error) {
      errors.push(`${job.label}: ${(error as Error).message}`);
    }
  }
  onProgress?.({ done: jobs.length, total: jobs.length, label: '' });

  const stamped = papers.map((p) => ({
    ...p,
    ...((p.publicationDate ?? '') > today && { publicationDate: today }),
    firstSeen: now.toISOString(),
  }));
  return { papers: deduplicate(stamped).slice(0, LIVE_FETCH_MAX_PAPERS), errors };
}
