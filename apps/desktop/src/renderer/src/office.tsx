import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HomeView, HostBridgeProvider } from '@tagalong/ui';
import type { AgentHost } from '@tagalong/ui';
// Bundled, not fetched: Home's two typefaces ship inside the app, Latin subset only.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './office.css';
import '../../shared/ipc';

/**
 * How Home changes an agent on the desktop: the same host calls Settings used, so saving is
 * still `pets.upsert` in main, and the desktop pet is `settings.defaultPetId`.
 */
const agentHost: AgentHost = {
  setup: async () => {
    const view = await window.tagalongHost.getHostView();
    return {
      providers: view.providers.map(({ id, label }) => ({ id, label })),
      desktopPetId: view.settings.defaultPetId,
      // A new agent starts where a key is already stored, else on the default provider.
      newAgentProviderId:
        view.providers.find((choice) => choice.needsKey && choice.hasKey)?.id ??
        view.settings.providerId,
    };
  },
  listModels: (providerId) => window.tagalongHost.listModels(providerId),
  savePet: (pet) => window.tagalongHost.savePet(pet),
  deletePet: (petId) => window.tagalongHost.deletePet(petId),
  setDesktopPet: async (petId) => {
    await window.tagalongHost.saveSettings({ defaultPetId: petId });
  },
};

/**
 * The Home window (the page keeps its old `office` name). Everything it draws comes from
 * HomeView in @tagalong/ui; this entry hands it the preload bridge, which already receives
 * every turn event, and the host calls that change an agent.
 */
const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <HostBridgeProvider bridge={window.tagalong}>
        <HomeView agentHost={agentHost} />
      </HostBridgeProvider>
    </StrictMode>,
  );
}
