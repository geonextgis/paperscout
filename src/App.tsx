import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ExportPage } from './pages/ExportPage';
import { ForYouPage } from './pages/ForYouPage';
import { JournalsPage } from './pages/JournalsPage';
import { LatestPage } from './pages/LatestPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SavedPage } from './pages/SavedPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { LibraryProvider } from './store/LibraryContext';
import { ProfileProvider, useProfile } from './store/ProfileContext';
import { SelectionProvider } from './store/SelectionContext';

/** First visit → onboarding. Everything else is reachable without it. */
function Home() {
  const { profile } = useProfile();
  return profile.onboarded ? <ForYouPage /> : <Navigate to="/welcome" replace />;
}

// HashRouter: GitHub Pages has no server-side rewrites, so deep links must live in the URL hash.
export function App() {
  return (
    <ProfileProvider>
      <LibraryProvider>
        <SelectionProvider>
          <HashRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="welcome" element={<OnboardingPage />} />
                <Route path="latest" element={<LatestPage />} />
                <Route path="journals" element={<JournalsPage />} />
                <Route path="search" element={<SearchPage />} />
                <Route path="saved" element={<SavedPage />} />
                <Route path="export" element={<ExportPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </HashRouter>
        </SelectionProvider>
      </LibraryProvider>
    </ProfileProvider>
  );
}
