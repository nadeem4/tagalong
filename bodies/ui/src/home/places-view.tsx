/**
 * Home's Places page: every place you can talk to Scout (this PC, the browser add-on, WhatsApp),
 * its state and how to set it up. WhatsApp's setup lives under its row: five fields, one switch,
 * one Save. A saved value shows only the word Saved, never itself; what is typed goes to the
 * brain once and the field is cleared. The brain owns the bridge; this asks, then reads again
 * when it says `bodies` changed. Contains PlacesView.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { BodiesState, WhatsAppChange, WhatsAppField } from '../shapes';
import { Button } from '../controls/button';
import { Toggle } from '../controls/toggle';
import { useHostBridge } from '../host-bridge';

// The tour's Browser step is where the add-on's folder and its load-unpacked steps are shown.
const BROWSER_STEP = 7;

const FIELDS: { id: WhatsAppField; label: string; secret: boolean; hint: string }[] = [
  {
    id: 'accessToken',
    label: 'Access token',
    secret: true,
    hint: 'The long-lived token from Meta',
  },
  {
    id: 'appSecret',
    label: 'App secret',
    secret: true,
    hint: 'Checks that messages come from Meta',
  },
  {
    id: 'verifyToken',
    label: 'Verify token',
    secret: true,
    hint: 'Any phrase you pick; Meta asks for it once',
  },
  {
    id: 'phoneNumberId',
    label: 'Phone number ID',
    secret: false,
    hint: 'The ID of the number Scout sends from',
  },
  {
    id: 'allowedNumber',
    label: 'Your number',
    secret: false,
    hint: 'Only messages from this number reach Scout',
  },
];

const STATE_LINE: Record<string, string> = {
  off: 'WhatsApp is off.',
  starting: 'WhatsApp is starting.',
  running: 'WhatsApp is running.',
  not_built: 'The WhatsApp bridge is not built yet. Build it, then switch WhatsApp off and on.',
  node_failed:
    'Scout could not get Node to run the WhatsApp bridge. It tries again when you switch WhatsApp off and on.',
};
const WAITING = 'WhatsApp is waiting for all five values. Save all five to switch it on.';
const SAVE_FAILED = 'Scout could not save the WhatsApp settings.';

const EMPTY: Record<WhatsAppField, string> = {
  accessToken: '',
  appSecret: '',
  verifyToken: '',
  phoneNumberId: '',
  allowedNumber: '',
};

type Standing = 'connected' | 'not-set-up' | 'offline';

const STANDING_WORDS: Record<Standing, string> = {
  connected: 'Connected',
  'not-set-up': 'Not set up',
  offline: 'Offline',
};
const STANDING_DOT: Record<Standing, string> = {
  connected: 'home-dot',
  'not-set-up': 'home-dot home-dot--off',
  offline: 'home-dot home-dot--warn',
};
const STANDING_CLASS: Record<Standing, string> = {
  connected: 'cx-status',
  'not-set-up': 'cx-status cx-status--off',
  offline: 'cx-status cx-status--warn',
};

function StandingLabel({ standing }: { standing: Standing }) {
  return (
    <span className={STANDING_CLASS[standing]}>
      <span className={STANDING_DOT[standing]} aria-hidden="true" />
      {STANDING_WORDS[standing]}
    </span>
  );
}

function Place({
  tile,
  name,
  chip,
  purpose,
  children,
}: {
  tile: string;
  name: string;
  chip?: string;
  purpose: string;
  children: ReactNode;
}) {
  return (
    <div className="cx-row">
      <span className="cx-tile" aria-hidden="true">
        {tile}
      </span>
      <div className="cx-row__main">
        <span className="cx-row__name">
          <span>{name}</span>
          {chip !== undefined && <span className="cx-chip cx-chip--quiet">{chip}</span>}
        </span>
        <span className="cx-meta">{purpose}</span>
      </div>
      <div className="cx-row__side">{children}</div>
    </div>
  );
}

export function PlacesView() {
  const bridge = useHostBridge();
  const formId = useId();
  const [state, setState] = useState<BodiesState | null>(null);
  const [failed, setFailed] = useState(false);
  const [setup, setSetup] = useState(false);
  const [typed, setTyped] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const refresh = useCallback(() => {
    bridge
      .bodiesState()
      .then((latest) => {
        setFailed(false);
        setState(latest);
      })
      .catch((error: unknown) => {
        console.error('could not read bodies', error);
        setFailed(true);
      });
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onBrainChanged((what) => {
      if (what === 'bodies') refresh();
    });
  }, [bridge, refresh]);

  // One path for Save and the switch. On a refusal only the fixed line shows: the thrown text
  // is dropped, because it could repeat something that was typed.
  const send = async (change: WhatsAppChange): Promise<boolean> => {
    setBusy(true);
    setSaveFailed(false);
    try {
      await bridge.setWhatsApp(change);
      return true;
    } catch {
      setSaveFailed(true);
      return false;
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const head = (
    <div className="home-head">
      <h1 className="home-title">Places</h1>
      <p>The places you can talk to Scout. Each one is the same Scout and the same conversation.</p>
    </div>
  );

  if (state === null) {
    return (
      <>
        {head}
        {failed && (
          <p role="alert">Tagalong could not read this. It loads again when Home reopens.</p>
        )}
      </>
    );
  }

  const connected = (kind: 'desktop' | 'browser' | 'whatsapp'): boolean =>
    state.bodies.find((body) => body.kind === kind)?.connected === true;
  const wa = state.whatsapp;
  const pc: Standing = connected('desktop') ? 'connected' : 'offline';
  const browser: Standing = connected('browser') ? 'connected' : 'not-set-up';
  const whatsapp: Standing = connected('whatsapp')
    ? 'connected'
    : wa.complete
      ? 'offline'
      : 'not-set-up';

  const changes: WhatsAppChange = {};
  for (const { id } of FIELDS) {
    const value = typed[id].trim();
    if (value !== '') changes[id] = value;
  }
  const dirty = Object.keys(changes).length > 0;
  const save = async (): Promise<void> => {
    if (await send(changes)) setTyped(EMPTY);
  };

  return (
    <>
      {head}
      <section className="tg-card" aria-label="Places">
        <ul className="cx-list">
          <li className="cx-item">
            <Place
              tile="PC"
              name="This PC"
              chip="Desktop"
              purpose="Scout sits on your screen, reads what you point it at and talks out loud."
            >
              <StandingLabel standing={pc} />
            </Place>
          </li>
          <li className="cx-item">
            <Place
              tile="C"
              name="Chrome add-on"
              purpose="Scout reads the page you are on, and you can talk to it from the toolbar."
            >
              <StandingLabel standing={browser} />
              {browser !== 'connected' && (
                <Button
                  variant="secondary"
                  onClick={() => void bridge.openWalkthrough(BROWSER_STEP)}
                >
                  Get the add-on
                </Button>
              )}
            </Place>
          </li>
          <li className="cx-item">
            <Place
              tile="W"
              name="WhatsApp"
              purpose="Message Scout from your phone. It answers in the same chat."
            >
              <StandingLabel standing={whatsapp} />
              {setup ? (
                <Toggle
                  checked={wa.enabled}
                  label="WhatsApp"
                  disabled={busy || (!wa.complete && !wa.enabled)}
                  onChange={(enabled) => void send({ enabled })}
                />
              ) : (
                <Button
                  variant="secondary"
                  aria-expanded={false}
                  aria-controls={formId}
                  onClick={() => setSetup(true)}
                >
                  {whatsapp === 'connected' ? 'Settings' : 'Set up'}
                </Button>
              )}
            </Place>
            {setup && (
              <form
                id={formId}
                className="cx-form"
                aria-busy={busy}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (dirty && !busy) void save();
                }}
              >
                <p role="status" aria-live="polite" className="cx-form__lead">
                  {wa.complete || wa.enabled
                    ? (STATE_LINE[wa.state] ?? STATE_LINE['off'])
                    : WAITING}
                </p>
                <div className="cx-two">
                  {FIELDS.map(({ id, label, secret, hint }) => {
                    const inputId = `${formId}-${id}`;
                    return (
                      <div key={id} className="cx-field">
                        <label htmlFor={inputId} className="cx-field__lbl">
                          {label}
                        </label>
                        <input
                          id={inputId}
                          className="cx-input"
                          type={secret ? 'password' : 'text'}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={wa.set[id] ? 'Saved' : ''}
                          aria-describedby={`${inputId}-hint`}
                          value={typed[id]}
                          onChange={(event) => setTyped({ ...typed, [id]: event.target.value })}
                        />
                        <span id={`${inputId}-hint`} className="cx-field__hint">
                          {hint}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {saveFailed && (
                  <p role="alert" className="cx-form__error">
                    {SAVE_FAILED}
                  </p>
                )}
                <div className="cx-form__actions">
                  <Button variant="primary" type="submit" disabled={!dirty || busy}>
                    Save
                  </Button>
                </div>
              </form>
            )}
          </li>
        </ul>
      </section>
    </>
  );
}
