/**
 * The standalone Settings window's page, opened only when the engine failed to start (Home
 * needs the engine). Renders SettingsPage without Home around it.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Bundled, not fetched: the two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './settings.css';
import { SettingsPage } from './settings/settings-page';

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <SettingsPage />
    </StrictMode>,
  );
}
