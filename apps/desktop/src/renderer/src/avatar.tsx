import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_PET_COLOR, PetAvatar } from '@tagalong/ui';
import type { PetState } from '@tagalong/ui';
import type { Pet } from '@tagalong/protocol';
import './app.css';
import '../../shared/ipc';
import { nextPetStates, visibleCrew } from './crew';

/**
 * The crew on the desktop: one avatar per visible pet, docked side by side in one window.
 *
 * The window background is the drag handle, so the strip moves as one; each avatar is its
 * own no-drag button, because a plain click on a drag region never arrives. Clicking a pet
 * opens the panel on it. During a roundtable each pet's ring lights as it takes its turn.
 */
function Avatar() {
  const [pets, setPets] = useState<Pet[]>([]);
  const [states, setStates] = useState<Record<string, PetState>>({});
  const [sightPaused, setSightPaused] = useState(false);

  useEffect(() => {
    Promise.all([window.tagalong.listPets(), window.tagalongHost.getHostView()])
      .then(([all, view]) => {
        const shown = visibleCrew(all, view.settings.hiddenPets, view.settings.defaultPetId);
        setPets(shown);
        void window.tagalongHost.resizeStrip(shown.length);
      })
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
        if (event.type.startsWith('turn.') && 'turnId' in event && event.turnId !== undefined) {
          const { turnId } = event;
          const petId = event.type === 'turn.started' ? event.petId : undefined;
          setStates((current) =>
            nextPetStates(current, { type: event.type, turnId, ...(petId ? { petId } : {}) }),
          );
        }
      }),
    [],
  );

  return (
    <div className="avatar">
      {pets.map((pet) => (
        <button
          key={pet.id}
          type="button"
          className="avatar__pet"
          title={`${pet.name} · ${pet.model} — click to chat`}
          aria-label={`Chat with ${pet.name}`}
          style={{ borderBottomColor: pet.color ?? DEFAULT_PET_COLOR }}
          onClick={() => void window.tagalongHost.selectPet(pet.id)}
        >
          <PetAvatar pet={pet} state={states[pet.id] ?? 'idle'} sightPaused={sightPaused} />
        </button>
      ))}
      {pets.length === 0 && (
        <button
          type="button"
          className="avatar__open"
          onClick={() => void window.tagalongHost.togglePanel()}
        >
          chat
        </button>
      )}
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
