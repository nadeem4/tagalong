/**
 * "Reach Scout away from home": four steps to put the brain's computer and this one on the same
 * Tailscale network. A step is done when the desktop finds what it asks for, not when it is
 * ticked. Contains TailscaleGuide.
 */
import { useEffect, useState } from 'react';
import { Button } from '../controls/button';
import { CopyButton } from '../controls/copy-button';
import { useHostBridge } from '../host-bridge';
import type { BrainCard } from '../host-bridge';
import { tailnetHost } from '../shapes';
import type { TailscaleState } from '../shapes';

function Step({
  done,
  title,
  children,
}: {
  done: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className={done ? 'ts-step ts-step--done' : 'ts-step'}>
      <span className="ts-mark" aria-hidden="true">
        {done ? '✓' : ''}
      </span>
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </li>
  );
}

export function TailscaleGuide({ onClose }: { onClose: () => void }) {
  const bridge = useHostBridge();
  const [tailscale, setTailscale] = useState<TailscaleState | null>(null);
  const [card, setCard] = useState<BrainCard | null>(null);

  useEffect(() => {
    void bridge.tailscaleState().then(setTailscale, () => undefined);
    void bridge.brainCard().then(setCard, () => undefined);
  }, [bridge]);

  if (tailscale === null || card === null) return null;

  const machine = card.host ?? 'the brain computer';
  const tailnet = tailnetHost(card.addr);
  const overTailnet = card.local === false && tailnet !== null;
  const brainDone = overTailnet || (card.local !== false && tailscale.ip !== null);
  const deviceDone = tailscale.ip !== null;
  const working = overTailnet && card.status === 'running';

  return (
    <section className="tg-card ts-guide" aria-label="Reach Scout away from home">
      <div className="ts-head">
        <h2 className="tg-card__label">Reach Scout away from home</h2>
        <span className="tg-chip">{working ? 'Working' : 'Free for personal use'}</span>
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
      <p>
        Tailscale joins your devices in a private network, so they find each other from anywhere.
        Nothing is opened to the internet.
      </p>
      <ol className="ts-steps">
        <Step
          done={brainDone}
          title={
            brainDone ? `Tailscale is running on ${machine}` : `Install Tailscale on ${machine}`
          }
        >
          {!brainDone && (
            <p className="cx-meta">Sign in with the account you will use everywhere.</p>
          )}
        </Step>
        <Step
          done={deviceDone}
          title={
            deviceDone ? 'Tailscale is running on this device' : 'Install Tailscale on this device'
          }
        >
          {!deviceDone && (
            <p className="cx-meta">
              {tailscale.installed ? 'Open Tailscale and sign in.' : 'It is free for personal use.'}
            </p>
          )}
          {!tailscale.installed && (
            <Button variant="secondary" onClick={() => void bridge.openTailscaleDownload()}>
              Open the Tailscale download page
            </Button>
          )}
        </Step>
        <Step
          done={overTailnet}
          title={
            overTailnet
              ? `Paired using ${machine}'s Tailscale address`
              : `Pair using ${machine}'s Tailscale address`
          }
        >
          {!overTailnet && (
            <p className="cx-meta">
              On {machine}, choose Pair a device, then paste its link in the tour's brain step.
            </p>
          )}
        </Step>
        <Step done={working} title="Check it works" />
      </ol>
      {working && tailnet !== null && (
        <p className="ts-address">
          <span className="cx-meta">Address</span> <code>{tailnet}</code>{' '}
          <CopyButton text={tailnet} copy={bridge.copyText} />
        </p>
      )}
    </section>
  );
}
