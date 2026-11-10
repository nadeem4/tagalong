/**
 * Home's "Read my mail for loops" card, on the Connections page: one switch per mail app (off
 * until the person turns it on, with one plain line about where mail goes), the Held list of
 * every loop the brain holds, Forget per loop, and Stop and wipe behind an in-page confirm.
 * The brain owns it all; this asks, then reads again when it says `loops` changed. A row shows
 * what the loop is, never the mail it came from. Contains LoopsPanel.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { LoopRow, LoopsState } from '../shapes';
import { Button } from '../controls/button';
import { Toggle } from '../controls/toggle';
import { useHostBridge } from '../host-bridge';

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const SHORT_TIME: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};
const STATUS: Record<LoopRow['status'], string> = {
  held: 'Held',
  snoozed: 'Snoozed',
  done: 'Done',
  dropped: 'Dropped',
  stale: 'Gone quiet',
};

function meta(loop: LoopRow): string[] {
  const parts = [loop.direction === 'i_owe' ? 'You owe' : 'Waiting on them'];
  if (loop.people.length > 0) parts.push(loop.people.join(', '));
  if (loop.due !== null) {
    parts.push(`Due ${new Date(loop.due).toLocaleDateString('en-US', SHORT_DATE)}`);
  }
  parts.push(STATUS[loop.status]);
  return parts;
}

/** Tomorrow 09:00 on the person's clock, as ISO with the local offset (the brain refuses naive times). */
function tomorrowNine(): string {
  const at = new Date();
  at.setDate(at.getDate() + 1);
  at.setHours(9, 0, 0, 0);
  const offset = -at.getTimezoneOffset();
  const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const zone = `${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T09:00:00${zone}`;
}

export function LoopsPanel() {
  const bridge = useHostBridge();
  const headingId = useId();
  const [state, setState] = useState<LoopsState | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const stopRef = useRef<HTMLButtonElement>(null);
  const backToStop = useRef(false); // Cancel/Escape: focus returns to the button that opened it
  const cancel = () => {
    backToStop.current = true;
    setConfirming(false);
  };
  useEffect(() => {
    if (!confirming && backToStop.current) {
      backToStop.current = false;
      stopRef.current?.focus();
    }
  }, [confirming]);

  const refresh = useCallback(() => {
    bridge
      .loopsState()
      .then((latest) => {
        setFailed(false);
        setState(latest);
      })
      .catch((error: unknown) => {
        console.error('could not read loops', error);
        setFailed(true);
      });
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onBrainChanged((what) => {
      if (what === 'loops' || what === 'apps') refresh(); // Gmail may have just connected
    });
  }, [bridge, refresh]);

  // Read again either way: on a refusal the card then shows what the brain really holds.
  const run = (call: Promise<void>): void => {
    void call.catch((error: unknown) => console.error('loops call failed', error)).then(refresh);
  };

  if (state === null) {
    return failed ? (
      <section className="home-card loops" aria-labelledby={headingId}>
        <h2 id={headingId} className="home-card__label">
          READ MY MAIL FOR LOOPS
        </h2>
        <p role="alert">Tagalong could not read this. It loads again when Home reopens.</p>
      </section>
    ) : null;
  }

  const anyOn = state.apps.some((app) => app.on);
  const open = state.loops.filter((loop) => loop.status !== 'done' && loop.status !== 'dropped');
  return (
    <section className="home-card loops" aria-labelledby={headingId}>
      <h2 id={headingId} className="home-card__label">
        READ MY MAIL FOR LOOPS
      </h2>
      <p>
        Scout can notice what is waiting on you in your mail, and bring it up when it matters. It
        only reads, never sends or changes your mail. Off until you turn it on.
      </p>
      <p>Your mail goes to Anthropic to be read. The loops it finds stay on this computer.</p>
      {state.apps.length === 0 && <p>Connect Gmail above and the switch appears here.</p>}
      {state.apps.map((app) => (
        <div key={app.id} className="loops-app">
          <div className="loops-app__row">
            <span className="loops-app__name">{app.name}</span>
            <Toggle
              checked={app.on}
              label={`Read my mail for loops (${app.name})`}
              onChange={(on) => run(bridge.setLoopsOn(app.id, on))}
            />
          </div>
          {app.on && app.unreadSince !== undefined && (
            <p className="loops-app__note loops-app__note--warn">
              <span className="home-dot home-dot--warn" aria-hidden="true" /> Mail unread since{' '}
              {new Date(app.unreadSince).toLocaleTimeString('en-US', SHORT_TIME)}
            </p>
          )}
        </div>
      ))}

      <div className="loops-held">
        <h3 className="perm-group__title">Held{open.length > 0 ? ` (${open.length})` : ''}</h3>
        {state.loops.length === 0 ? (
          <p>Nothing is held.</p>
        ) : (
          <ul aria-label="Held" className="loops-list">
            {state.loops.map((loop) => (
              <li key={loop.id} className="loops-row">
                <span className="loops-row__body">
                  <span className="loops-row__title">{loop.title}</span>
                  <span className="loops-row__asks">{loop.asks}</span>
                  <span className="loops-row__meta">
                    {meta(loop).map((part, index) => (
                      <span key={index}>{part}</span>
                    ))}
                  </span>
                </span>
                {loop.status !== 'done' && loop.status !== 'dropped' && (
                  <>
                    <Button
                      variant="secondary"
                      aria-label={`Done ${loop.title}`}
                      onClick={() => run(bridge.loopDone(loop.id))}
                    >
                      Done
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={`Later ${loop.title}`}
                      onClick={() => run(bridge.loopLater(loop.id, tomorrowNine()))}
                    >
                      Later
                    </Button>
                  </>
                )}
                <Button
                  variant="quiet"
                  aria-label={`Forget ${loop.title}`}
                  onClick={() => run(bridge.forgetLoop(loop.id))}
                >
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(anyOn || state.loops.length > 0) && !confirming && (
        <Button variant="secondary" ref={stopRef} onClick={() => setConfirming(true)}>
          Stop and wipe
        </Button>
      )}
      {confirming && (
        <div
          role="alert"
          className="loops-confirm"
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancel();
          }}
        >
          <p>
            This turns mail reading off and deletes every held loop. Your mail itself is not
            touched. It can't be undone.
          </p>
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(false);
              run(bridge.wipeLoops());
            }}
          >
            Wipe
          </Button>
          <Button variant="quiet" autoFocus onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}
