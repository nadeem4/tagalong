/**
 * The avatar window's page: Scout on the desktop as Bean, the 3D figure, with its mood, the
 * sight-paused, recording and listening marks, and the top status mark. Mood rules live in dock.ts and pointer and
 * drop handling in pet-input.ts; this file only wires them to the host.
 */
import { StrictMode, useEffect, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DockPet } from '@tagalong/ui';
import type { ListeningDot } from '@tagalong/ui';
import type { Pet, StatusMark } from '@tagalong/ui/shapes';
import type { ListeningState } from '../../shared/ipc';
// Bundled, not fetched: the dock's tags are Onest 600, Latin subset only.
import '@fontsource/onest/latin-600.css';
import './app.css';
import '../../shared/ipc';
import { FIGURE } from './bean-assets';
import { IDLE_DOCK, dockMood, nextDock } from './dock';
import { petInput } from './pet-input';

/** How long "Seeing" shows after a capture. */
const SEEING_MS = 2500;

/**
 * The companion on the desktop: Bean in a small transparent window. The pet
 * is a button that is dragged by hand rather than through a drag region, which would swallow
 * its clicks: a press that moves past a few pixels drags the pet (and its bubble), a press
 * that does not is a click, which opens the bubble and clears "Done". A file, link or text
 * dragged in from another app is dropped on the pet instead: Scout shows Seeing while it is
 * held over, and the bubble opens on a card asking what to do with it.
 */
function Avatar() {
  const [pet, setPet] = useState<Pet | null>(null);
  const [dock, send] = useReducer(nextDock, IDLE_DOCK);
  const [sightPaused, setSightPaused] = useState(false);
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState<ListeningState>({
    on: false,
    paused: false,
    followUp: false,
  });
  // Speech heard while listening all the time: the dot pulses. The words are never read here.
  const [hearing, setHearing] = useState(false);
  const [status, setStatus] = useState<StatusMark | null>(null);
  const [input] = useState(() => petInput(window.tagalongHost, send));

  useEffect(() => {
    window.tagalong
      .listPets()
      .then((all) => setPet(all[0] ?? null))
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

  // Always listening, read on mount too: the mark shows from the first second it is on.
  useEffect(() => {
    window.tagalongHost
      .getListening()
      .then(setListening)
      .catch((error: unknown) => console.error('could not read Always listening', error));
    return window.tagalongHost.onListening(setListening);
  }, []);

  // The ears' events reach every window: only whether speech started or the turn ended counts.
  useEffect(
    () =>
      window.tagalongHost.onEarsEvent((event) => {
        if (event === 'speechStart') setHearing(true);
        else if (event === 'turnEnd') setHearing(false);
      }),
    [],
  );
  // A session that ended mid-turn never sends its turnEnd: a pause or the switch ends hearing.
  useEffect(() => {
    if (!listening.on || listening.paused) setHearing(false);
  }, [listening.on, listening.paused]);

  // The top status mark (why Scout cannot think, Listening, ...), read on mount for the same reason.
  useEffect(() => {
    window.tagalongHost
      .getStatusMark()
      .then(setStatus)
      .catch((error: unknown) => console.error('could not read the status mark', error));
    return window.tagalongHost.onStatusMark(setStatus);
  }, []);

  // Brain turn events, and main's presence.away and presence.back on the same channel.
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
        title={`${pet.name} — click to ask, drag to move`}
        aria-label={`Ask ${pet.name}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          input.pointerDown({ x: event.screenX, y: event.screenY });
        }}
        onPointerMove={(event) => input.pointerMove({ x: event.screenX, y: event.screenY })}
        onPointerUp={() => input.pointerUp()}
        onDragEnter={(event) => input.dragOver(event)}
        onDragOver={(event) => input.dragOver(event)}
        onDragLeave={() => input.dragLeave()}
        onDrop={(event) => input.drop(event)}
        onClick={() => {
          // The click that ends a drag is not a click on the pet.
          if (!input.takeClick()) return;
          void window.tagalongHost.openBubble();
        }}
      >
        <DockPet
          pet={pet}
          mood={dockMood(dock)}
          figure={FIGURE}
          sightPaused={sightPaused}
          recording={recording}
          listening={listeningDot(listening, hearing)}
          status={status}
        />
      </button>
    </div>
  );
}

/** The listening dot: paused first, then speech heard, then the follow-up window's ring. */
function listeningDot(listening: ListeningState, hearing: boolean): ListeningDot | undefined {
  if (!listening.on) return undefined;
  if (listening.paused) return 'paused';
  if (hearing) return 'hearing';
  return listening.followUp ? 'follow-up' : 'on';
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Avatar />
    </StrictMode>,
  );
}
