import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PetAvatar } from '@tagalong/ui';
import type { PetState } from '@tagalong/ui';
import type { Pet } from '@tagalong/protocol';
import './app.css';
import '../../shared/ipc';

/**
 * The pet on the desktop. The window itself is the drag handle, so opening the panel
 * needs its own no-drag button — a plain click on a drag region never arrives.
 */
function Avatar() {
  const [pet, setPet] = useState<Pet | null>(null);
  const [state, setState] = useState<PetState>('idle');
  const [sightPaused, setSightPaused] = useState(false);

  useEffect(() => {
    window.tagalong
      .listPets()
      .then((pets) => setPet(pets[0] ?? null))
      .catch((error: unknown) => console.error('could not list pets', error));
  }, []);

  // Asked for on mount as well as subscribed to: this window is recreated on show, so
  // one that opened after the last toggle would otherwise render sight as running while
  // it is paused — the one lie this indicator cannot afford to tell.
  useEffect(() => {
    window.tagalongHost
      .getSightPaused()
      .then(setSightPaused)
      .catch((error: unknown) => console.error('could not read the sight pause', error));
    return window.tagalongHost.onSightPause(setSightPaused);
  }, []);

  useEffect(
    () =>
      window.tagalong.onTurnEvent((event) => {
        if (event.type === 'turn.started') setState('thinking');
        if (event.type === 'turn.completed' || event.type === 'turn.error') setState('idle');
      }),
    [],
  );

  return (
    <div className="avatar">
      {pet !== null && <PetAvatar pet={pet} state={state} sightPaused={sightPaused} />}
      <button
        type="button"
        className="avatar__open"
        onClick={() => void window.tagalongHost.togglePanel()}
      >
        chat
      </button>
    </div>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Avatar />
    </StrictMode>,
  );
}
