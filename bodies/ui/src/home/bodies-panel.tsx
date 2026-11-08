/**
 * Home's Bodies card, on the Connections page: which of Scout's bodies (desktop, browser,
 * WhatsApp) are connected, and the WhatsApp setup: five fields, one switch, one Save. A saved
 * value shows only the word Saved, never itself; what is typed goes to the brain once and the
 * field is cleared. The brain owns the bridge; this asks, then reads again when it says `bodies`
 * changed. Contains BodiesPanel.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import type { BodiesState, WhatsAppChange, WhatsAppField } from '../shapes';
import { Button } from '../controls/button';
import { Toggle } from '../controls/toggle';
import { useHostBridge } from '../host-bridge';

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
    hint: 'The only number Scout will answer',
  },
];

const STATE_LINE: Record<string, string> = {
  off: 'WhatsApp is off.',
  incomplete: 'WhatsApp is waiting for all five values.',
  starting: 'WhatsApp is starting.',
  running: 'WhatsApp is running.',
  not_built: 'The WhatsApp bridge is not built yet. Build it, then switch WhatsApp off and on.',
  node_failed:
    'Scout could not get Node to run the WhatsApp bridge. It tries again when you switch WhatsApp off and on.',
};
const SAVE_FAILED = 'Scout could not save the WhatsApp settings.';

const EMPTY: Record<WhatsAppField, string> = {
  accessToken: '',
  appSecret: '',
  verifyToken: '',
  phoneNumberId: '',
  allowedNumber: '',
};

export function BodiesPanel() {
  const bridge = useHostBridge();
  const headingId = useId();
  const reasonId = useId();
  const [state, setState] = useState<BodiesState | null>(null);
  const [failed, setFailed] = useState(false);
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

  if (state === null) {
    return failed ? (
      <section className="home-card bodies" aria-labelledby={headingId}>
        <h2 id={headingId} className="home-card__label">
          BODIES
        </h2>
        <p role="alert">Tagalong could not read this. It loads again when Home reopens.</p>
      </section>
    ) : null;
  }

  const wa = state.whatsapp;
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
    <section className="home-card bodies" aria-labelledby={headingId}>
      <h2 id={headingId} className="home-card__label">
        BODIES
      </h2>
      <p>Where you can reach Scout. Each one is the same Scout and the same conversation.</p>
      <ul aria-label="Bodies" className="bodies-list">
        {state.bodies.map((body) => (
          <li key={body.kind} className="bodies-row">
            <span
              className={`home-dot${body.connected ? '' : ' home-dot--off'}`}
              aria-hidden="true"
            />
            <span className="bodies-row__name">{body.name}</span>
            <span className="bodies-row__state">
              {body.connected ? 'Connected' : 'Not connected'}
            </span>
          </li>
        ))}
      </ul>

      <div className="bodies-wa">
        <div className="bodies-wa__head">
          <div className="bodies-wa__title">
            <h3 className="perm-group__title">WhatsApp</h3>
            <p role="status" aria-live="polite">
              {STATE_LINE[wa.state] ?? STATE_LINE['off']}
            </p>
          </div>
          <Toggle
            checked={wa.enabled}
            label="WhatsApp"
            disabled={busy || (!wa.complete && !wa.enabled)}
            describedBy={wa.complete ? undefined : reasonId}
            onChange={(enabled) => void send({ enabled })}
          />
        </div>
        {!wa.complete && (
          <p id={reasonId} className="bodies-wa__note">
            Save all five values to switch WhatsApp on.
          </p>
        )}

        <form
          className="bodies-form"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && !busy) void save();
          }}
        >
          {FIELDS.map(({ id, label, secret, hint }) => {
            const inputId = `${headingId}-${id}`;
            const isSet = wa.set[id];
            return (
              <div key={id} className="bodies-field">
                <div className="bodies-field__top">
                  <label htmlFor={inputId}>{label}</label>
                  {isSet && <span className="bodies-field__saved">Saved</span>}
                </div>
                <input
                  id={inputId}
                  type={secret ? 'password' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={isSet ? 'Saved' : ''}
                  aria-describedby={`${inputId}-hint`}
                  value={typed[id]}
                  onChange={(event) => setTyped({ ...typed, [id]: event.target.value })}
                />
                <span id={`${inputId}-hint`} className="bodies-field__hint">
                  {hint}
                </span>
              </div>
            );
          })}
          <div className="bodies-form__foot">
            <p>
              These values stay on this PC. Scout does not show them again; type a new one to
              replace it.
            </p>
            <Button variant="primary" type="submit" disabled={!dirty || busy}>
              Save
            </Button>
          </div>
          {saveFailed && (
            <p role="alert" className="bodies-wa__error">
              {SAVE_FAILED}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
