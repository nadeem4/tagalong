import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopCompanion, jobFor } from '@tagalong/ui';
import type { Pet, Role } from '@tagalong/protocol';
// Bundled, not fetched: the name plate is set in the pixel face.
import '@fontsource/pixelify-sans/latin-400.css';
import './app.css';
import '../../shared/ipc';
import {
  NO_ACTIVITY,
  NO_WATCH_CUES,
  anyWatching,
  clearAlerts,
  companionFor,
  helpersOf,
  isLook,
  isWorking,
  nextActivity,
  nextWatchCues,
} from './crew';

/**
 * The desktop companion: one pet, docked where the user left it, answering beside their
 * work while the rest of the crew helps behind it.
 *
 * The window background is the drag handle; the pet is its own no-drag button, because a
 * plain click on a drag region never arrives. Clicking it opens the chat on it.
 */
function Avatar() {
  const [pets, setPets] = useState<Pet[]>([]);
  const [companion, setCompanion] = useState<Pet | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [sightAlways, setSightAlways] = useState(false);
  const [sightPaused, setSightPaused] = useState(false);
  const [recording, setRecording] = useState(false);
  const [captures, setCaptures] = useState(0);
  const [activity, setActivity] = useState(NO_ACTIVITY);
  const [cues, setCues] = useState(NO_WATCH_CUES);
  // Meetings will raise this when a pet is waiting on the user; nothing does yet.
  const [needsYou] = useState(false);

  // This window is reloaded when the default pet or the sight permission changes, so
  // reading both once on mount is enough.
  useEffect(() => {
    Promise.all([window.tagalong.listPets(), window.tagalongHost.getHostView()])
      .then(([all, view]) => {
        setPets(all);
        setCompanion(companionFor(all, view.settings.defaultPetId) ?? null);
        setSightAlways(view.settings.sight === 'always');
      })
      .catch((error: unknown) => console.error('could not list pets', error));
    window.tagalong
      .listRoles()
      .then(setRoles)
      // No roles reads every pet as a generalist, which still draws the companion.
      .catch((error: unknown) => console.error('could not list roles', error));
  }, []);

  // Asked for on mount as well as subscribed to: a window that opened after the last
  // toggle would otherwise show sight running while it is paused.
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

  // Every look badges the pet for a second: nothing read from the screen is unannounced.
  useEffect(
    () =>
      window.tagalongHost.onCapture((notice) => {
        if (isLook(notice)) setCaptures((count) => count + 1);
      }),
    [],
  );

  useEffect(
    () =>
      window.tagalong.onTurnEvent((event) => {
        if (event.type === 'watch.status' || event.type === 'watch.fired') {
          setCues((current) => nextWatchCues(current, event));
          return;
        }
        setActivity((current) => nextActivity(current, event));
      }),
    [],
  );

  if (companion === null) {
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

  const helpers = helpersOf(activity, companion.id)
    .map((id) => pets.find((pet) => pet.id === id))
    .filter((pet): pet is Pet => pet !== undefined);

  return (
    <DesktopCompanion
      pet={companion}
      job={jobFor(companion.roleId, roles)}
      working={isWorking(activity)}
      captureCount={captures}
      sightPaused={sightPaused}
      sightAlways={sightAlways}
      recording={recording}
      watching={anyWatching(cues)}
      alert={cues.alerts.length > 0}
      needsYou={needsYou}
      helpers={helpers}
      onSelect={() => {
        setCues(clearAlerts);
        void window.tagalongHost.selectPet(companion.id);
      }}
    />
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
