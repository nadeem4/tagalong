import { useEffect, useState } from 'react';
import type { ContextSnapshot, Pet } from '@tagalong/protocol';
import { ChatPanel, HostBridgeProvider } from '@tagalong/ui';
import type { ConnectionStatus } from '../engine-connection';
import type { PortBridge } from '../port-bridge';
import { PAGE_TARGETS } from '../page-targets';
import { describeStatus } from '../status-text';

export { PAGE_TARGETS };

export interface SidePanelAppProps {
  bridge: PortBridge;
  openOptions: () => void;
}

/**
 * The side panel: connection state, and the shared chat panel for Scout.
 *
 * The panel reads the page it opened beside as soon as it is connected, so "summarise this"
 * with nothing selected is answered from the page text. The sight bar names what is
 * attached and Clear drops it, so nothing leaves the browser unannounced.
 */
export function SidePanelApp({ bridge, openOptions }: SidePanelAppProps) {
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'connecting' });
  const [snapshot, setSnapshot] = useState<ContextSnapshot | undefined>(undefined);
  // The pets as last seen connected. Kept through a disconnect so the conversation on screen
  // survives the app restarting: an ask made meanwhile fails in the chat, readably.
  const [pets, setPets] = useState<Pet[]>([]);
  const connected = status.state === 'connected';
  // Scout: the companion the engine lists first.
  const activePet = pets[0];

  useEffect(
    () =>
      bridge.onStatus((next) => {
        setStatus(next);
        if (next.state === 'connected') setPets(next.pets);
      }),
    [bridge],
  );
  useEffect(() => bridge.onContext((captured) => setSnapshot(captured ?? undefined)), [bridge]);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    bridge
      .capture(PAGE_TARGETS)
      .then((captured) => {
        // A shortcut capture that arrived meanwhile is newer; keep it.
        if (live && captured !== null) setSnapshot((current) => current ?? captured);
      })
      // A page Chrome will not let extensions read is an ordinary state, shown as blind.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bridge, connected]);

  return (
    <HostBridgeProvider bridge={bridge}>
      <div className="panel">
        <header className="panel__header">
          <p data-testid="connection" data-state={status.state} className="panel__status">
            {describeStatus(status)}
          </p>
          {(status.state === 'unpaired' || status.state === 'rejected') && (
            <button type="button" onClick={openOptions}>
              Pair with the Tagalong app
            </button>
          )}
        </header>
        {activePet !== undefined && (
          <ChatPanel
            petId={activePet.id}
            pets={pets}
            {...(snapshot !== undefined ? { snapshot } : {})}
            lookTargets={PAGE_TARGETS}
            lookLabel="Read this page"
          />
        )}
      </div>
    </HostBridgeProvider>
  );
}
