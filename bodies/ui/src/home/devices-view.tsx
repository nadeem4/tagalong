/**
 * Home's Devices page: this PC and every paired computer, browser and AI tool (rename, revoke,
 * pair another), plus the browser add-on and WhatsApp with its setup under its row: five fields,
 * one switch, one Save. A saved value shows only the word Saved, never itself; what is typed goes
 * to the brain once and the field is cleared. The brain owns it all; this asks, then reads again
 * when it says `bodies` changed. Contains DevicesView.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  BodiesState,
  DeviceRow,
  DevicesState,
  WhatsAppChange,
  WhatsAppField,
} from '../shapes';
import { Button } from '../controls/button';
import { Toggle } from '../controls/toggle';
import { useHostBridge } from '../host-bridge';
import { PairDialog } from '../pair/pair-dialog';
import { PAIR_CSS } from '../pair/pair-styles';
import { DeviceRowItem } from './device-row';
import { Place, StandingLabel } from './place-row';
import { TailscaleGuide } from './tailscale-guide';
import type { Standing } from './place-row';

// The tour's Browser step is where the add-on's folder and its load-unpacked steps are shown.
const BROWSER_STEP = 8;

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

export function DevicesView({ reach = false }: { reach?: boolean }) {
  const bridge = useHostBridge();
  const formId = useId();
  const [state, setState] = useState<BodiesState | null>(null);
  const [paired, setPaired] = useState<DevicesState | null>(null);
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [joined, setJoined] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [guide, setGuide] = useState(reach);
  const [failed, setFailed] = useState(false);
  const [setup, setSetup] = useState(false);
  const [typed, setTyped] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const refresh = useCallback(() => {
    Promise.all([bridge.bodiesState(), bridge.devicesState()])
      .then(([latest, devices]) => {
        const all = [...devices.devices, ...devices.aiTools];
        const before = known.current;
        known.current = new Set(all.map((device) => device.id));
        if (before !== null) {
          const added = all.filter((device) => !before.has(device.id));
          if (added.length > 0) {
            setFresh((now) => new Set([...now, ...added.map((device) => device.id)]));
            setJoined(added[0]!.name);
          }
        }
        setFailed(false);
        setState(latest);
        setPaired(devices);
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
    <div className="home-head dv-head">
      <div>
        <h1 className="home-title">Devices</h1>
        <p>Everything that can talk to Scout, and where its brain lives.</p>
      </div>
      {state !== null && (
        <Button variant="primary" onClick={() => setPairing(true)}>
          Pair a device
        </Button>
      )}
    </div>
  );

  if (state === null || paired === null) {
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
  const kindOf = (device: { kind: string }): 'desktop' | 'browser' =>
    device.kind === 'browser' ? 'browser' : 'desktop';
  const isOnline = (name: string, kind: 'desktop' | 'browser'): boolean =>
    state.bodies.some((body) => body.kind === kind && body.connected && body.name === name);
  // An online body that is not a paired device (this PC, the add-on) keeps its own row.
  const unpaired = (kind: 'desktop' | 'browser') =>
    state.bodies.filter(
      (body) =>
        body.kind === kind &&
        body.connected &&
        !paired.devices.some((device) => kindOf(device) === kind && device.name === body.name),
    );
  const hasPaired = (kind: 'desktop' | 'browser') =>
    paired.devices.some((device) => kindOf(device) === kind);
  // With none online and none paired of a kind, one row says so.
  const bodiesOf = (kind: 'desktop' | 'browser') => {
    const online = unpaired(kind);
    if (online.length > 0) return online;
    return hasPaired(kind) ? [] : [null];
  };
  const whatsapp: Standing = connected('whatsapp')
    ? 'connected'
    : wa.complete
      ? 'offline'
      : 'not-set-up';
  const nothingPaired = paired.devices.length === 0 && paired.aiTools.length === 0;
  const itemFor = (device: DeviceRow) => (
    <DeviceRowItem
      key={device.id}
      device={device}
      online={device.kind !== 'mcp_client' && isOnline(device.name, kindOf(device))}
      fresh={fresh.has(device.id)}
      onRename={async (name) => {
        await bridge.renameDevice(device.id, name);
        refresh();
      }}
      onRevoke={async () => {
        await bridge.revokeDevice(device.id);
        refresh();
      }}
    />
  );

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
      <style>{PAIR_CSS}</style>
      {head}
      {joined !== null && (
        <p className="dv-joined" role="status">
          {joined} is paired. It can now talk to Scout.
        </p>
      )}
      {pairing && (
        <PairDialog
          make={bridge.pairMake}
          copyText={bridge.copyText}
          enableNetwork={async () => (await bridge.installBrainService()).ok}
          onClose={() => setPairing(false)}
        />
      )}
      {nothingPaired && (
        <section className="tg-card dv-empty" aria-label="Only this computer so far">
          <h2 className="tg-card__label">Only this computer so far</h2>
          <p>
            Pair a second PC, your browser or a phone and they all share one Scout: the same memory,
            the same jobs. Away from home works too, through Tailscale.
          </p>
          <div className="dv-empty__actions">
            <Button variant="primary" onClick={() => setPairing(true)}>
              Pair a device
            </Button>
            <Button variant="secondary" onClick={() => setGuide(true)}>
              Reach Scout away from home
            </Button>
          </div>
        </section>
      )}
      {guide && <TailscaleGuide onClose={() => setGuide(false)} />}
      <section className="tg-card" aria-label="Computers and browsers">
        <ul className="cx-list">
          {paired.devices.map(itemFor)}
          {bodiesOf('desktop').map((desktop) => (
            <li className="cx-item" key={desktop?.id ?? 'offline'}>
              <Place
                tile="PC"
                name={desktop?.name ?? 'This PC'}
                chips={['Desktop']}
                purpose="Scout sits on your screen, reads what you point it at and talks out loud."
              >
                <StandingLabel standing={desktop !== null ? 'connected' : 'offline'} />
              </Place>
            </li>
          ))}
          {bodiesOf('browser').map((browser) => (
            <li className="cx-item" key={browser?.id ?? 'not-set-up'}>
              <Place
                tile="C"
                name={browser?.name ?? 'Chrome add-on'}
                purpose="Scout reads the page you are on, and you can talk to it from the toolbar."
              >
                <StandingLabel standing={browser !== null ? 'connected' : 'not-set-up'} />
                {browser === null && (
                  <Button
                    variant="secondary"
                    onClick={() => void bridge.openWalkthrough(BROWSER_STEP)}
                  >
                    Get the add-on
                  </Button>
                )}
              </Place>
            </li>
          ))}
        </ul>
      </section>
      {paired.aiTools.length > 0 && (
        <section className="tg-card" aria-label="AI tools">
          <ul className="cx-list">{paired.aiTools.map(itemFor)}</ul>
        </section>
      )}
      <section className="tg-card" aria-label="Messaging">
        <ul className="cx-list">
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
