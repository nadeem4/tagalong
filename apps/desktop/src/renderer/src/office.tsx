import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HomeView, HostBridgeProvider } from '@tagalong/ui';
import type { HomeHost, HomePage } from '@tagalong/ui';
// Bundled, not fetched: Home's two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './office.css';
import '../../shared/ipc';
import { SettingsPage } from './settings/settings-page';

/** How Home reads and changes the companion on the desktop: the same host calls as before. */
const homeHost: HomeHost = {
  setup: async () => {
    const view = await window.tagalongHost.getHostView();
    return {
      companionId: view.settings.defaultPetId,
      // The fake provider is for tests and demos, never offered.
      providers: view.providers
        .filter((choice) => choice.id !== 'fake')
        .map(({ id, label, needsKey }) => ({ id, label, needsKey })),
    };
  },
  listModels: (providerId) => window.tagalongHost.listModels(providerId),
  savePet: (pet) => window.tagalongHost.savePet(pet),
};

/**
 * The Home window (the page keeps its old `office` name): the one window for the companion,
 * its experts, activity and settings. Main names a page when the tray or the bubble opens a
 * particular one, such as Settings.
 */
function Home() {
  const [page, setPage] = useState<HomePage | undefined>(undefined);
  useEffect(() => window.tagalongHost.onHomePage((next) => setPage(next as HomePage)), []);
  return (
    <HostBridgeProvider bridge={window.tagalong}>
      <HomeView
        host={homeHost}
        settings={<SettingsPage embedded onOpenScout={() => setPage('scout')} />}
        {...(page === undefined ? {} : { page })}
        onPage={setPage}
      />
    </HostBridgeProvider>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Home />
    </StrictMode>,
  );
}
