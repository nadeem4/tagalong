/**
 * The first-run walkthrough's page (built as `walkthrough.html`): Walkthrough from @tagalong/ui
 * with the desktop's host calls. Main opens it at ?step=N (the no-key button opens step 9).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HostBridgeProvider, Walkthrough } from '@tagalong/ui';
import type { WalkthroughHost } from '@tagalong/ui';
// Bundled, not fetched: the same two typefaces as Home, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '../../shared/ipc';
import type { SettingsPatch } from '../../shared/settings';
import { FIGURE } from './bean-assets';
import { fullBridge } from './full-bridge';
import { listMicrophones } from './mic';
import { previewVoice } from './voice-player';

const bridge = fullBridge();
const host = window.tagalongHost;

const walkthroughHost: WalkthroughHost = {
  keyStatus: bridge.keyStatus,
  setKey: bridge.setKey,
  setDailyLimit: bridge.setDailyLimit,
  onBrainChanged: bridge.onBrainChanged,
  openWalkthrough: bridge.openWalkthrough,
  expertStatus: () => host.expertStatus(),
  finishWalkthrough: () => host.finishWalkthrough(),
  getSettings: async () => (await host.getHostView()).settings,
  // Main validates the patch; the steps send plain strings the form already limited.
  saveSettings: (patch) => host.saveSettings(patch as SettingsPatch),
  previewVoice: (preview) => previewVoice(preview, new AbortController().signal),
  listMicrophones: () => listMicrophones(),
  browserFolder: () => host.browserFolder(),
  showBrowserFolder: () => host.showBrowserFolder(),
  copyText: (text) => navigator.clipboard.writeText(text),
  openHome: () => host.openHome(),
};

const stepParam = Number(new URLSearchParams(window.location.search).get('step'));
const initialStep = Number.isInteger(stepParam) && stepParam >= 1 && stepParam <= 9 ? stepParam : 1;

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <HostBridgeProvider bridge={bridge}>
        <Walkthrough host={walkthroughHost} scout={FIGURE.idle} initialStep={initialStep} />
      </HostBridgeProvider>
    </StrictMode>,
  );
}
