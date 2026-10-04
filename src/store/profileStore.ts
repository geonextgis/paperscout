/**
 * Persistence boundary for the user profile.
 *
 * The UI only talks to `ProfileStore`. Today the single implementation writes
 * to localStorage; a Supabase/Firebase-backed store implementing the same
 * (already asynchronous) interface can replace it without touching components.
 */
import { DEFAULT_FILTERS, DEFAULT_WEIGHTS, EMPTY_PROFILE, type UserProfile } from '../types/profile';

export interface ProfileStore {
  load(): Promise<UserProfile>;
  save(profile: UserProfile): Promise<void>;
  clear(): Promise<void>;
}

/** Accepts anything previously stored (or imported) and returns a complete, valid profile. */
export function migrateProfile(raw: unknown): UserProfile {
  if (!raw || typeof raw !== 'object') return EMPTY_PROFILE;
  const r = raw as Partial<UserProfile>;
  const array = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  return {
    ...EMPTY_PROFILE,
    onboarded: !!r.onboarded,
    topics: array(r.topics).filter((t) => typeof t === 'string'),
    journals: array(r.journals).filter((j) => j && typeof j.name === 'string'),
    authors: array(r.authors).filter((a) => typeof a === 'string'),
    examplePapers: array(r.examplePapers).filter((p) => p?.id && p.title),
    savedPapers: array(r.savedPapers).filter((p) => p?.id && p.title),
    dismissedIds: array(r.dismissedIds),
    filters: { ...DEFAULT_FILTERS, ...r.filters },
    weights: { ...DEFAULT_WEIGHTS, ...r.weights },
    extraPapers: array(r.extraPapers).filter((p) => p?.id && p.title),
    extraFetchedAt: r.extraFetchedAt,
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
  };
}

export class LocalStorageProfileStore implements ProfileStore {
  constructor(private readonly key = 'paperscout.profile.v1') {}

  async load(): Promise<UserProfile> {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? migrateProfile(JSON.parse(raw)) : EMPTY_PROFILE;
    } catch {
      return EMPTY_PROFILE;
    }
  }

  async save(profile: UserProfile): Promise<void> {
    try {
      localStorage.setItem(this.key, JSON.stringify(profile));
    } catch {
      // Quota exceeded: the on-demand Crossref cache is the only bulky, re-fetchable part.
      try {
        localStorage.setItem(this.key, JSON.stringify({ ...profile, extraPapers: [], extraFetchedAt: undefined }));
      } catch {
        /* storage unavailable (private mode) — the session still works in memory */
      }
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}

/** Swap this line to move persistence to a backend. */
export const profileStore: ProfileStore = new LocalStorageProfileStore();
