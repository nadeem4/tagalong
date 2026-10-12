import { StrictMode, useEffect, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DockPet } from '@tagalong/ui';
import type { Pet } from '@tagalong/protocol';
import './app.css';
import '../../shared/ipc';
import { visibleCrew } from './crew';
import { IDLE_DOCK, dockMood, nextDock } from './dock';

/** How long "Seeing" shows after a capture. */
const SEEING_MS = 2500;

/**
 * The companion on the desktop: its pixel character in a small transparent window. The
 * window background is the drag handle; the pet is a no-drag button, because a plain click
 * on a drag region never arrives. Clicking it opens the bubble and clears "Done".
 */
function Avatar() {
  const [pet, setPet] = useState<Pet | null>(null);
  const [dock, send] = useReducer(nextDock, IDLE_DOCK);
  const [sightPaused, setSightPaused] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    Promise.all([window.tagalong.listPets(), window.tagalongHost.getHostView()])
      .then(([all, view]) => {
        const companion = visibleCrew(all, view.settings.hiddenPets, view.settings.defaultPetId)[0];
        setPet(companion ?? null);
        void window.tagalongHost.resizeStrip(1);
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

  // The recording dot, read on mount for the same reason as the pause above.
  useEffect(() => {
    window.tagalongHost
      .getRecording()
      .then(setRecording)
      .catch((error: unknown) => console.error('could not read rolling memory state', error));
    return window.tagalongHost.onRecording(setRecording);
  }, []);

  useEffect(() => window.tagalong.onTurnEvent((event) => send(event)), []);

  // Every capture is announced: the pet looks up and says "Seeing" for a moment.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.tagalongHost.onCapture((notice) => {
      if (notice.paused === true || notice.blocked !== undefined) return;
      send({ type: 'seeing' });
      clearTimeout(timer);
      timer = setTimeout(() => send({ type: 'seen' }), SEEING_MS);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, []);

  if (pet === null) {
    return (
      <div className="avatar">
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

  return (
    <div className="avatar">
      <button
        type="button"
        className="avatar__pet"
        title={`${pet.name} — click to ask`}
        aria-label={`Ask ${pet.name}`}
        onClick={() => {
          send({ type: 'looked' });
          void window.tagalongHost.selectPet(pet.id);
        }}
      >
        <DockPet pet={pet} mood={dockMood(dock)} sightPaused={sightPaused} recording={recording} />
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
