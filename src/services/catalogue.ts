/**
 * Loads the pre-built catalogue that GitHub Actions publishes next to the app.
 * This is the only data request the site makes on page load — no scholarly API
 * is called unless the user explicitly asks for a live lookup.
 */
import type { CatalogueMeta, JournalInfo, Paper } from '../types/paper';

export interface Catalogue {
  papers: Paper[];
  journals: JournalInfo[];
  meta: CatalogueMeta | null;
}

async function load<T>(file: string, fallback: T): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { cache: 'no-cache' });
  if (response.status === 404) return fallback;
  if (!response.ok) throw new Error(`Could not load ${file} (HTTP ${response.status})`);
  return (await response.json()) as T;
}

export async function loadCatalogue(): Promise<Catalogue> {
  const [papers, journals, meta] = await Promise.all([
    load<Paper[]>('papers.json', []),
    load<JournalInfo[]>('journals.json', []),
    load<CatalogueMeta | null>('last_updated.json', null),
  ]);
  return { papers, journals, meta };
}
