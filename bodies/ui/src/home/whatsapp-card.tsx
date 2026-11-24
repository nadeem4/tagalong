/**
 * WhatsApp's card on Devices: its standing and, under its row, the setup: five fields, one
 * switch, one Save. A saved value shows only the word Saved, never itself; what is typed goes to
 * the brain once and the field is cleared. Contains WhatsAppCard.
 */
import { useId, useState } from 'react';
import type { BodiesState, WhatsAppChange, WhatsAppField } from '../shapes';
import { Button } from '../controls/button';
import { Toggle } from '../controls/toggle';
import { useHostBridge } from '../host-bridge';
import { Place, StandingLabel } from './place-row';

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

export function WhatsAppCard({
  wa,
  connected,
  onChanged,
}: {
  wa: BodiesState['whatsapp'];
  connected: boolean;
  onChanged: () => void;
}) {
  const bridge = useHostBridge();
  const formId = useId();
  const [setup, setSetup] = useState(false);
  const [typed, setTyped] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

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
      onChanged();
    }
  };

  const changes: WhatsAppChange = {};
  for (const { id } of FIELDS) {
    const value = typed[id].trim();
    if (value !== '') changes[id] = value;
  }
  const dirty = Object.keys(changes).length > 0;
  const save = async (): Promise<void> => {
    if (await send(changes)) setTyped(EMPTY);
  };
  const standing = connected ? 'Online' : wa.complete ? 'Offline' : 'Not set up';

  return (
    <section className="tg-card" aria-labelledby={`${formId}-head`}>
      <div className="dv-group">
        <h2 id={`${formId}-head`} className="tg-card__label">
          Messaging
        </h2>
      </div>
      <ul className="cx-list">
        <li className="cx-item">
          <Place
            icon="chat"
            name="WhatsApp"
            purpose="Message Scout from your phone. It answers in the same chat."
          >
            <StandingLabel standing={connected ? 'online' : 'off'} words={standing} />
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
                {connected ? 'Settings' : 'Set up'}
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
                {wa.complete || wa.enabled ? (STATE_LINE[wa.state] ?? STATE_LINE['off']) : WAITING}
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
  );
}
