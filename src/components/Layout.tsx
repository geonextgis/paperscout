import { NavLink, Outlet } from 'react-router-dom';
import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import { useSelection } from '../store/SelectionContext';
import { SOURCE_LABELS } from '../types/paper';
import { relativeDay } from '../utils/format';
import { SelectionBar } from './SelectionBar';

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
  const { profile } = useProfile();
  const selection = useSelection();
  const sources = meta?.sources.filter((s) => s.status === 'ok' || s.status === 'partial').map((s) => SOURCE_LABELS[s.source]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <NavLink to="/" className="brand" aria-label="PaperScout home">
            <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="currentColor" />
              <path d="M9 7h10l4 4v14H9z" fill="var(--surface)" />
              <path d="M12 13h8M12 17h8M12 21h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>PaperScout</span>
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
