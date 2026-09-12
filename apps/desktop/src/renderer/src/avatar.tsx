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

  useEffect(() => {
    window.tagalong
      .listPets()
      .then((pets) => setPet(pets[0] ?? null))
      .catch((error: unknown) => console.error('could not list pets', error));
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
      {pet !== null && <PetAvatar pet={pet} state={state} />}
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
