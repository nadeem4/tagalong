/**
 * Home's Devices page: this computer (marked when it holds Scout's brain), every paired computer
 * and browser, and the AI tools, each in its own group with a count (rename, revoke, pair
 * another), plus the browser add-on and WhatsApp's card. The brain owns it all; this asks, then reads again when it
 * says `bodies` changed. Contains DevicesView.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { aiToolLabel } from '../shapes';
import type { BodiesState, DeviceRow, DevicesState } from '../shapes';
import { Button } from '../controls/button';
import { useHostBridge } from '../host-bridge';
import { Icon } from '../icons';
import { ConnectToolDialog } from './connect-tool';
import { HostPairDialog } from '../pair/host-pair-dialog';
import { DeviceRowItem } from './device-row';
import { Place, StandingLabel } from './place-row';
import { TailscaleGuide } from './tailscale-guide';
import { useBrainCard } from './use-brain-card';
import { WhatsAppCard } from './whatsapp-card';

// The tour's Browser step is where the add-on's folder and its load-unpacked steps are shown.
const BROWSER_STEP = 8;

const nothingPaired = (paired: DevicesState): boolean =>
  paired.devices.length === 0 && paired.aiTools.length === 0;

export function DevicesView({ reach = false }: { reach?: boolean }) {
  const bridge = useHostBridge();
  const { card } = useBrainCard();
  const [state, setState] = useState<BodiesState | null>(null);
  const [paired, setPaired] = useState<DevicesState | null>(null);
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [pairing, setPairing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [guide, setGuide] = useState(reach);
  const [failed, setFailed] = useState(false);

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

  const refreshDevices = useCallback(() => {
    void bridge.devicesState().then(setPaired, () => undefined);
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onBrainChanged((what) => {
      if (what === 'bodies') refresh();
    });
  }, [bridge, refresh]);

  const head = (
    <div className="home-head home-head--row">
      <div>
        <h1 className="home-title">Devices</h1>
        <p>Everything that can talk to Scout, and where its brain lives.</p>
      </div>
      {state !== null && paired !== null && !nothingPaired(paired) && (
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

  // A body that is a paired device shows as that device's row; the rest (this computer, the
  // add-on, and the offline row the brain keeps for a kind with none online) keep their own.
  const isOnline = (device: DeviceRow): boolean =>
    state.bodies.some((body) => body.connected && body.device_id === device.id);
  const unpaired = (kind: 'desktop' | 'browser') =>
    state.bodies.filter((body) => body.kind === kind && body.device_id === undefined);
  const isFresh = (device: DeviceRow): boolean => fresh.has(device.id) && !isOnline(device);
  const joined = [...paired.devices, ...paired.aiTools].find(isFresh);
  const itemFor = (device: DeviceRow) => (
    <DeviceRowItem
      key={device.id}
      device={device}
      online={isOnline(device)}
      fresh={isFresh(device)}
      onRename={async (name) => {
        await bridge.renameDevice(device.id, name);
        refreshDevices();
      }}
      onRevoke={async () => {
        await bridge.revokeDevice(device.id);
        refreshDevices();
      }}
    />
  );
  const holdsBrain = card?.local === true;
  const whatsappUp = state.bodies.find((body) => body.kind === 'whatsapp')?.connected === true;

  return (
    <>
      {head}
      {joined !== undefined && (
        <p className="dv-joined" role="status">
          <Icon name="check" />
          {joined.kind === 'mcp_client' ? aiToolLabel(joined.name) : joined.name} is paired. It can
          now talk to Scout.
        </p>
      )}
      {pairing && <HostPairDialog host={bridge} onClose={() => setPairing(false)} />}
      {connecting && (
        <ConnectToolDialog
          host={bridge}
          onClose={() => setConnecting(false)}
          onDone={() => {
            setConnecting(false);
            refreshDevices();
          }}
        />
      )}
      {nothingPaired(paired) && (
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
      {guide && <TailscaleGuide card={card} onClose={() => setGuide(false)} />}
      <section className="tg-card" aria-labelledby="dv-machines">
        <div className="dv-group">
          <h2 id="dv-machines" className="tg-card__label">
            Computers and browsers
          </h2>
          <span className="cx-meta">{paired.devices.length} paired</span>
        </div>
        <ul className="cx-list">
          {unpaired('desktop').map((desktop) => (
            <li className="cx-item" key={desktop.id}>
              <Place
                icon="pc"
                brain={holdsBrain}
                name={desktop.connected ? desktop.name : 'This PC'}
                chips={[
                  ...(holdsBrain ? [{ label: "Scout's brain", tone: 'rec' as const }] : []),
                  { label: 'This computer' },
                ]}
                purpose={`Desktop · ${holdsBrain ? 'always on' : 'Scout sits on your screen'}`}
              >
                <StandingLabel
                  standing={desktop.connected ? 'online' : 'off'}
                  words={desktop.connected ? 'Online' : 'Offline'}
                />
              </Place>
            </li>
          ))}
          {paired.devices.map(itemFor)}
          {unpaired('browser').map((browser) => (
            <li className="cx-item" key={browser.id}>
              <Place
                icon="globe"
                name={browser.connected ? browser.name : 'Chrome add-on'}
                purpose="Scout reads the page you are on, and you can talk to it from the toolbar."
              >
                <StandingLabel
                  standing={browser.connected ? 'online' : 'off'}
                  words={browser.connected ? 'Online' : 'Not set up'}
                />
                {!browser.connected && (
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
      <section className="tg-card" aria-labelledby="dv-ai">
        <div className="dv-group">
          <h2 id="dv-ai" className="tg-card__label">
            AI tools
          </h2>
          <span className="cx-meta">{paired.aiTools.length} paired</span>
          <Button variant="secondary" onClick={() => setConnecting(true)}>
            Connect another AI tool
          </Button>
        </div>
        {paired.aiTools.length === 0 && (
          <p className="home-note">
            Claude Code, Codex or Cursor can read what Scout remembers and add to it.
          </p>
        )}
        <ul className="cx-list">{paired.aiTools.map(itemFor)}</ul>
      </section>
      <WhatsAppCard wa={state.whatsapp} connected={whatsappUp} onChanged={refresh} />
    </>
  );
}
