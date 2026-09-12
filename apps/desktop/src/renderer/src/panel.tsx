import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatPanel, HostBridgeProvider } from '@tagalong/ui';
import type { ContextSnapshot } from '@tagalong/protocol';
import './app.css';
import '../../shared/ipc';

/**
 * The chat surface. The snapshot arrives from main on every hotkey press, so the chip
 * always describes the capture that opened the panel rather than a stale one.
 */
function Panel() {
  const [snapshot, setSnapshot] = useState<ContextSnapshot | null>(null);
  const [petId, setPetId] = useState<string | null>(null);

  useEffect(() => {
    void window.tagalongHost.getContext().then(setSnapshot);
    return window.tagalongHost.onContext(setSnapshot);
  }, []);

  useEffect(() => {
    window.tagalong
      .listPets()
      .then((pets) => setPetId(pets[0]?.id ?? null))
      .catch((error: unknown) => console.error('could not list pets', error));
  }, []);

  if (petId === null) return <p className="settings__note">Waking the crew…</p>;

  return (
    <HostBridgeProvider bridge={window.tagalong}>
      <ChatPanel petId={petId} {...(snapshot !== null ? { snapshot } : {})} />
    </HostBridgeProvider>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Panel />
    </StrictMode>,
  );
}
