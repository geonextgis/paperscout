import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Paper } from '../types/paper';
import { EMPTY_PROFILE, type FollowedJournal, type PaperFilters, type SignalWeights, type UserProfile } from '../types/profile';
import { journalKey } from '../utils/normalize';
import { migrateProfile, profileStore } from './profileStore';

interface ProfileApi {
  profile: UserProfile;
  /** Low-level escape hatch; prefer the named actions below. */
  update(change: (profile: UserProfile) => UserProfile): void;
  addTopic(topic: string): void;
  removeTopic(topic: string): void;
  followJournal(journal: FollowedJournal): void;
  unfollowJournal(name: string): void;
  isFollowing(name: string | undefined): boolean;
  addAuthor(name: string): void;
  removeAuthor(name: string): void;
  addExample(paper: Paper): void;
  removeExample(id: string): void;
  isExample(id: string): boolean;
  toggleSaved(paper: Paper): void;
  isSaved(id: string): boolean;
  dismiss(id: string): void;
  restore(id?: string): void;
  setFilters(filters: Partial<PaperFilters>): void;
  setWeights(weights: Partial<SignalWeights>): void;
  importProfile(raw: unknown): void;
  reset(): void;
}

const ProfileContext = createContext<ProfileApi | null>(null);

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    profileStore.load().then((p) => {
      loaded.current = true;
      setProfile(p);
    });
  }, []);

  useEffect(() => {
    if (loaded.current && profile) void profileStore.save(profile);
  }, [profile]);

  useEffect(() => {
    const theme = profile?.theme ?? 'system';
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [profile?.theme]);

  const update = useCallback((change: (p: UserProfile) => UserProfile) => {
    setProfile((current) => change(current ?? EMPTY_PROFILE));
  }, []);

  const api = useMemo<ProfileApi | null>(() => {
    if (!profile) return null;
    const savedIds = new Set(profile.savedPapers.map((p) => p.id));
    const exampleIds = new Set(profile.examplePapers.map((p) => p.id));
    const followed = new Set(profile.journals.map((j) => journalKey(j.name)));
    return {
      profile,
      update,
      addTopic: (topic) => {
        const t = topic.trim().replace(/\s+/g, ' ');
        if (t) update((p) => (p.topics.some((x) => sameText(x, t)) ? p : { ...p, topics: [...p.topics, t] }));
      },
      removeTopic: (topic) => update((p) => ({ ...p, topics: p.topics.filter((t) => t !== topic) })),
      followJournal: (journal) =>
        update((p) =>
          p.journals.some((j) => journalKey(j.name) === journalKey(journal.name))
            ? p
            : { ...p, journals: [...p.journals, { name: journal.name, ...(journal.issn?.length && { issn: journal.issn }) }] },
        ),
      unfollowJournal: (name) =>
        update((p) => ({ ...p, journals: p.journals.filter((j) => journalKey(j.name) !== journalKey(name)) })),
      isFollowing: (name) => !!name && followed.has(journalKey(name)),
      addAuthor: (name) => {
        const n = name.trim().replace(/\s+/g, ' ');
        if (n) update((p) => (p.authors.some((x) => sameText(x, n)) ? p : { ...p, authors: [...p.authors, n] }));
      },
      removeAuthor: (name) => update((p) => ({ ...p, authors: p.authors.filter((a) => a !== name) })),
      addExample: (paper) =>
        update((p) => (p.examplePapers.some((x) => x.id === paper.id) ? p : { ...p, examplePapers: [...p.examplePapers, paper] })),
      removeExample: (id) => update((p) => ({ ...p, examplePapers: p.examplePapers.filter((x) => x.id !== id) })),
      isExample: (id) => exampleIds.has(id),
      toggleSaved: (paper) =>
        update((p) =>
          p.savedPapers.some((x) => x.id === paper.id)
            ? { ...p, savedPapers: p.savedPapers.filter((x) => x.id !== paper.id) }
            : { ...p, savedPapers: [paper, ...p.savedPapers] },
        ),
      isSaved: (id) => savedIds.has(id),
      dismiss: (id) => update((p) => (p.dismissedIds.includes(id) ? p : { ...p, dismissedIds: [...p.dismissedIds, id] })),
      restore: (id) => update((p) => ({ ...p, dismissedIds: id ? p.dismissedIds.filter((x) => x !== id) : [] })),
      setFilters: (filters) => update((p) => ({ ...p, filters: { ...p.filters, ...filters } })),
      setWeights: (weights) => update((p) => ({ ...p, weights: { ...p.weights, ...weights } })),
      importProfile: (raw) => setProfile(migrateProfile(raw)),
      reset: () => {
        void profileStore.clear();
        setProfile(EMPTY_PROFILE);
      },
    };
  }, [profile, update]);

  if (!api) return null; // localStorage resolves within a tick
  return <ProfileContext.Provider value={api}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileApi {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>');
  return ctx;
}
