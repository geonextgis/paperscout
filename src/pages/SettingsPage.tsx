import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ExamplePaperPicker } from '../components/ExamplePaperPicker';
import { JournalPicker } from '../components/JournalPicker';
import { AuthorEditor, TopicEditor } from '../components/ProfileEditors';
import { downloadText } from '../export';
import { SIGNALS } from '../recommendation';
import { fetchForProfile, type LiveFetchProgress } from '../services/liveFetch';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import { SOURCE_LABELS } from '../types/paper';
import { DEFAULT_WEIGHTS, type SignalWeights, type UserProfile } from '../types/profile';
import { plural, relativeDay } from '../utils/format';

export function SettingsPage() {
  const { profile, update, setWeights, restore, importProfile, reset } = useProfile();
  const { meta, now } = useLibrary();
  const { hash } = useLocation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<LiveFetchProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);


  const runLiveFetch = async () => {
    setMessage(null);
    const { papers, errors } = await fetchForProfile(profile, setProgress);
    setProgress(null);
    update((p) => ({ ...p, extraPapers: papers, extraFetchedAt: new Date().toISOString() }));
    setMessage(
      `Fetched ${plural(papers.length, 'paper')} from Crossref.` + (errors.length ? ` ${errors.length} request(s) failed: ${errors[0]}` : ''),
    );
  };

  const exportProfile = () => {
    // The Crossref cache is re-fetchable; leave it out of backups.
    const backup: UserProfile = { ...profile, extraPapers: [], extraFetchedAt: undefined };
    downloadText(JSON.stringify(backup, null, 2), `paperscout-profile-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      importProfile({ ...JSON.parse(await file.text()), onboarded: true });
      setMessage('Profile imported.');
    } catch {
      setMessage('That file is not a valid PaperScout profile.');
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="muted">Your profile drives the ranking. It is stored in this browser only.</p>
      </div>
      {message && <div className="notice" role="status">{message}</div>}

      <section className="panel" id="topics">
        <h2>Research topics</h2>
        <p className="muted">Free text. A topic matches when its words appear in a paper’s title, keywords or abstract.</p>
        <TopicEditor />
      </section>

      <section className="panel" id="journals">
        <h2>Preferred journals</h2>
        <JournalPicker />
      </section>

      <section className="panel" id="examples">
        <h2>Example papers</h2>
        <p className="muted">Papers that represent your interests. New papers with similar titles, abstracts, keywords, authors or journals rank higher.</p>
        <ExamplePaperPicker />
      </section>

      <section className="panel" id="authors">
        <h2>Followed authors</h2>
        <AuthorEditor />
      </section>

      <section className="panel" id="ranking">
        <h2>Ranking weights</h2>
        <p className="muted">
          The match percentage is a weighted average of the core signals; bonus signals add points on top. Signals you have not
          configured (e.g. no example papers) are left out automatically. Set a weight to 0 to switch a signal off.
        </p>
        {SIGNALS.map((s) => (
          <label key={s.id} className="weight-row">
            <span>{s.label}{!s.isCore(profile) && <span className="muted"> · bonus</span>}</span>
            <input type="range" min={0} max={60} step={1} value={profile.weights[s.id]}
              onChange={(e) => setWeights({ [s.id]: Number(e.target.value) } as Partial<SignalWeights>)} />
            <span className="weight-value">{profile.weights[s.id]}</span>
          </label>
        ))}
        <button className="link-btn" onClick={() => setWeights(DEFAULT_WEIGHTS)}>Reset to defaults</button>
      </section>

      <section className="panel" id="live">
        <h2>Fetch papers for my profile</h2>
        <p className="muted">
          The shared catalogue covers the topics and journals configured by the site owner. If you follow others, pull the last 30 days for
          your own topics and journals directly from Crossref. This runs only when you click, and the result is cached in your browser.
        </p>
        <div className="action-row">
          <button className="btn" onClick={() => void runLiveFetch()} disabled={!!progress || (!profile.topics.length && !profile.journals.length)}>
            {progress ? `Fetching ${progress.done + 1}/${progress.total}: ${progress.label}…` : 'Fetch from Crossref now'}
          </button>
          {profile.extraPapers.length > 0 && (
            <button className="btn btn-ghost" onClick={() => update((p) => ({ ...p, extraPapers: [], extraFetchedAt: undefined }))}>
              Clear {plural(profile.extraPapers.length, 'cached paper')}
            </button>
          )}
        </div>
        {profile.extraFetchedAt && <p className="muted">Last fetched {relativeDay(profile.extraFetchedAt, now)}.</p>}
      </section>

      <section className="panel" id="dismissed">
        <h2>Dismissed papers</h2>
        <div className="action-row">
          <span>{plural(profile.dismissedIds.length, 'paper')} hidden from your feeds.</span>
          {profile.dismissedIds.length > 0 && <button className="btn" onClick={() => restore()}>Restore all</button>}
        </div>
      </section>

      <section className="panel" id="appearance">
        <h2>Appearance</h2>
        <div className="chips">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} className={`chip chip-toggle${profile.theme === t ? ' chip-on' : ''}`} aria-pressed={profile.theme === t}
              onClick={() => update((p) => ({ ...p, theme: t }))}>
              {t === 'system' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>

      <section className="panel" id="data">
        <h2>Backup &amp; reset</h2>
        <p className="muted">Move your profile to another browser or device with a backup file.</p>
        <div className="action-row">
          <button className="btn" onClick={exportProfile}>Export profile</button>
          <button className="btn" onClick={() => fileInput.current?.click()}>Import profile…</button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button className="btn btn-danger" onClick={() => { if (window.confirm('Delete your topics, journals, example papers, saved papers and settings from this browser?')) reset(); }}>
            Reset everything
          </button>
        </div>
      </section>

      <section className="panel" id="catalogue">
        <h2>Catalogue status</h2>
        {meta ? (
          <>
            <p className="muted">
              {meta.paperCount.toLocaleString()} papers · updated {new Date(meta.updatedAt).toLocaleString()} · each run looks back {meta.lookbackDays} days.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Source</th><th>Status</th><th>Records</th><th>Notes</th></tr></thead>
                <tbody>
                  {meta.sources.map((s) => (
                    <tr key={s.source}>
                      <td>{SOURCE_LABELS[s.source]}</td>
                      <td><span className={`tag status-${s.status}`}>{s.status}</span></td>
                      <td>{s.fetched.toLocaleString()}</td>
                      <td className="muted">{s.message ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">Catalogue topics: {meta.topics.join(' · ')}</p>
          </>
        ) : (
          <p className="muted">No catalogue has been published yet.</p>
        )}
      </section>
    </>
  );
}
