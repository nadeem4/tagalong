import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HostBridgeProvider, OfficeView } from '@tagalong/ui';
// Bundled, not fetched: the office's two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './office.css';
import '../../shared/ipc';

/**
 * The Crew Office window. Everything it draws comes from OfficeView in @tagalong/ui; this
 * entry only hands it the preload bridge, which already receives every turn event.
 */
const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <HostBridgeProvider bridge={window.tagalong}>
        <OfficeView />
      </HostBridgeProvider>
    </StrictMode>,
  );
}
