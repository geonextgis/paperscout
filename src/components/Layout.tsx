import { NavLink, Outlet } from 'react-router-dom';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import { useSelection } from '../store/SelectionContext';
import { SOURCE_LABELS } from '../types/paper';
import { relativeDay } from '../utils/format';
import { SelectionBar } from './SelectionBar';
import logoDark from '../assets/logo-dark.png';
import logoLight from '../assets/logo-light.png';

const NAV = [
  { to: '/', label: 'For You' },
  { to: '/latest', label: 'Latest' },
  { to: '/journals', label: 'Journals' },
  { to: '/search', label: 'Search' },
  { to: '/saved', label: 'Saved' },
  { to: '/export', label: 'Export' },
  { to: '/settings', label: 'Settings' },
];

export function Layout() {
  const { meta, now, loading, error } = useLibrary();
  const { profile, update } = useProfile();
  const selection = useSelection();
  const sources = meta?.sources.filter((s) => s.status === 'ok' || s.status === 'partial').map((s) => SOURCE_LABELS[s.source]);

  const toggleTheme = () => {
    // 'system' resolves to whatever the OS reports, so the first click always flips what is on screen.
    const current = profile.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : profile.theme;
    update((p) => ({ ...p, theme: current === 'dark' ? 'light' : 'dark' }));
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <NavLink to="/" className="brand" aria-label="PaperScout home">
            <img src={logoLight} className="brand-logo brand-logo-light" alt="PaperScout" width={499} height={112} />
            <img src={logoDark} className="brand-logo brand-logo-dark" alt="" width={499} height={112} />
          </NavLink>
          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                {item.label}
                {item.to === '/saved' && profile.savedPapers.length > 0 && <span className="nav-count">{profile.savedPapers.length}</span>}
                {item.to === '/export' && selection.count > 0 && <span className="nav-count">{selection.count}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="header-status" title={sources?.length ? `Sources: ${sources.join(', ')}` : undefined}>
            {meta ? (
              <>
                <span className="status-dot" /> Updated {relativeDay(meta.updatedAt, now)}
              </>
            ) : loading ? 'Loading…' : 'No catalogue yet'}
          </div>
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Switch between light and dark mode" title="Switch light / dark mode">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
      </header>

      <main className="main">
        {error && (
          <div className="notice notice-error" role="alert">
            The paper catalogue could not be loaded: {error}. Saved papers and settings still work.
          </div>
        )}
        <Outlet />
      </main>

      <footer className="footer">
        <span>
          {meta ? `${meta.paperCount.toLocaleString()} papers from ${meta.journalCount.toLocaleString()} journals` : 'PaperScout'}
          {sources?.length ? ` · ${sources.join(' · ')}` : ''}
        </span>
        <span>Your profile is stored only in this browser.</span>
      </footer>
      <SelectionBar />
    </div>
  );
}
