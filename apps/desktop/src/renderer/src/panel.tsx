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
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null);

  useEffect(() => {
    void window.tagalongHost.getContext().then(setSnapshot);
    return window.tagalongHost.onContext(setSnapshot);
  }, []);

  // A broken hotkey is invisible by nature: the user presses a key and nothing happens.
  // The panel is the surface they can still reach — through the tray — so it says which
  // binding failed. Read once for a panel opened after the failure, and subscribed so one
  // already open stops showing a problem the user has since fixed.
  useEffect(() => {
    void window.tagalongHost
      .getHostView()
      .then((view) => setHotkeyProblem(view.hotkeyError ?? null));
    return window.tagalongHost.onHotkeyProblem(setHotkeyProblem);
  }, []);

  // Opens on the default pet (Scout on a fresh install); the crew strip moves it from there.
  useEffect(() => {
    Promise.all([window.tagalong.listPets(), window.tagalongHost.getHostView()])
      .then(([pets, view]) => {
        const preferred = pets.find((pet) => pet.id === view.settings.defaultPetId);
        setPetId((preferred ?? pets[0])?.id ?? null);
      })
      .catch((error: unknown) => console.error('could not list pets', error));
  }, []);

  // A click on the desktop crew strip picks the pet this panel talks to.
  useEffect(() => window.tagalongHost.onActivePet(setPetId), []);

  if (petId === null) return <p className="settings__note">Waking the crew…</p>;

  return (
    <HostBridgeProvider bridge={window.tagalong}>
      {hotkeyProblem !== null && (
        <p className="settings__error" role="status" data-testid="hotkey-problem">
          {hotkeyProblem}{' '}
          <button type="button" onClick={() => void window.tagalongHost.openSettings()}>
            Open Settings
          </button>
        </p>
      )}
      <ChatPanel
        petId={petId}
        onPetChange={setPetId}
        {...(snapshot !== null ? { snapshot } : {})}
      />
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
