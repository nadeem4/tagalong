/**
 * "Reach Scout away from home": four steps to put the brain's computer and this one on the same
 * Tailscale network. It opens at once and fills in as the desktop answers; a step is done when
 * the desktop finds what it asks for, not when it is ticked. It looks again when the window
 * regains focus (after installing or signing in) and on Check again. Contains TailscaleGuide.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../controls/button';
import { CopyButton } from '../controls/copy-button';
import { useHostBridge } from '../host-bridge';
import type { BrainCard } from '../host-bridge';
import { tailnetHost } from '../shapes';
import type { TailscaleState } from '../shapes';

const DOWNLOAD = 'https://tailscale.com/download';

function Step({
  done,
  doneTitle,
  todoTitle,
  children,
}: {
  done: boolean;
  doneTitle: string;
  todoTitle: string;
  children?: React.ReactNode;
}) {
  return (
    <li className={done ? 'ts-step ts-step--done' : 'ts-step'}>
      <span className="ts-mark" aria-hidden="true">
        {done ? '✓' : ''}
      </span>
      <div>
        <strong>{done ? doneTitle : todoTitle}</strong>
        {children}
      </div>
    </li>
  );
}

export function TailscaleGuide({ card, onClose }: { card: BrainCard | null; onClose: () => void }) {
  const bridge = useHostBridge();
  const [tailscale, setTailscale] = useState<TailscaleState | null>(null);

  const check = useCallback(() => {
    void bridge.tailscaleState().then(setTailscale, () => undefined);
  }, [bridge]);

  useEffect(() => {
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [check]);

  const machine = card?.host ?? 'the brain computer';
  const tailnet = card === null ? null : tailnetHost(card.addr);
  const overTailnet = card?.local === false && tailnet !== null;
  const deviceDone = tailscale?.ip != null;
  const brainDone = overTailnet || (card !== null && card.local !== false && deviceDone);
  const working = overTailnet && card?.status === 'running';

  return (
    <section className="tg-card ts-guide" aria-label="Reach Scout away from home">
      <div className="ts-head">
        <h2 className="tg-card__label">Reach Scout away from home</h2>
        <span className="tg-chip">{working ? 'Working' : 'Free for personal use'}</span>
        <Button variant="quiet" onClick={check}>
          Check again
        </Button>
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
          doneTitle={`Tailscale is running on ${machine}`}
          todoTitle={`Install Tailscale on ${machine}`}
        >
          {!brainDone && (
            <p className="cx-meta">Sign in with the account you will use everywhere.</p>
          )}
        </Step>
        <Step
          done={deviceDone}
          doneTitle="Tailscale is running on this device"
          todoTitle="Install Tailscale on this device"
        >
          {!deviceDone && (
            <p className="cx-meta">
              {tailscale?.installed
                ? 'Open Tailscale and sign in.'
                : 'It is free for personal use.'}
            </p>
          )}
          {tailscale?.installed === false && (
            <a className="cx-link" href={DOWNLOAD} target="_blank" rel="noreferrer noopener">
              Open the Tailscale download page
            </a>
          )}
        </Step>
        <Step
          done={overTailnet}
          doneTitle={`Paired using ${machine}'s Tailscale address`}
          todoTitle={`Pair using ${machine}'s Tailscale address`}
        >
          {!overTailnet && (
            <p className="cx-meta">
              On {machine}, choose Pair a device, then paste its link in the tour's brain step.
            </p>
          )}
        </Step>
        <Step done={working} doneTitle="Check it works" todoTitle="Check it works" />
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
