/**
 * The first-run walkthrough's page (built as `walkthrough.html`): Walkthrough from @tagalong/ui
 * with the desktop's host calls. Main opens it at ?step=N (the no-key button opens step 9).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HostBridgeProvider, Walkthrough } from '@tagalong/ui';
import type { WalkthroughHost } from '@tagalong/ui';
// Bundled, not fetched: the same typeface as Home, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '../../shared/ipc';
import type { SettingsPatch } from '../../shared/settings';
import { fullBridge } from './full-bridge';
import { listMicrophones, openMic } from './mic';
import { watchLevel } from './mic-level';
import { previewVoice } from './voice-player';

const bridge = fullBridge();
const host = window.tagalongHost;

const walkthroughHost: WalkthroughHost = {
  keyStatus: bridge.keyStatus,
  setKey: bridge.setKey,
  setDailyLimit: bridge.setDailyLimit,
  usageSummary: bridge.usageSummary,
  onBrainChanged: bridge.onBrainChanged,
  openWalkthrough: bridge.openWalkthrough,
  setupOverview: bridge.setupOverview,
  // The button press is the OK, so the tour asks for no card.
  setupExpert: async (id) => {
    const result = await bridge.setupExpert(id, true);
    if (result.error !== undefined) throw new Error(result.error);
    return result;
  },
  // An app always shows its Allow card (the brain's rule); the tour just waits for the answer.
  setupApp: async (id, query) => {
    const result = await bridge.setupApp(id, false, query);
    if (result.error !== undefined) throw new Error(result.error);
    return result;
  },
  openKeyPage: () => host.openKeyPage(),
  finishWalkthrough: (options) => host.finishWalkthrough(options),
  getSettings: async () => (await host.getHostView()).settings,
  // Main validates the patch; the steps send plain strings the form already limited.
  saveSettings: (patch) => host.saveSettings(patch as SettingsPatch),
  previewVoice: (preview) => previewVoice(preview, new AbortController().signal),
  listMicrophones: () => listMicrophones(),
  // The meter's own short-lived mic: only the level leaves watchLevel, never a frame.
  watchMicLevel: (deviceId, onLevel, onError) =>
    watchLevel(() => openMic(deviceId), onLevel, onError),
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
        <Walkthrough host={walkthroughHost} initialStep={initialStep} />
      </HostBridgeProvider>
    </StrictMode>,
  );
}
