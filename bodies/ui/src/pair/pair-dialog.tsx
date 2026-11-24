/**
 * "Pair a device": the QR, link and time left of a fresh pairing code made on this PC's brain,
 * for another device to scan or paste. Opens from the tour's finish card. Contains PairDialog.
 */

import { useEffect, useState } from 'react';
import { Button, CopyButton } from '../controls';
import type { PairOffer } from '../shapes/pairing';
import { QrImage } from './qr-image';

interface PairDialogProps {
  make: () => Promise<PairOffer>;
  copyText: (text: string) => Promise<void>;
  onClose: () => void;
  /** Turns on the brain's network access for other devices; true when it worked. Absent: no prompt is offered. */
  enableNetwork?: () => Promise<boolean>;
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Counts down to expiry, on its own tick so the QR beside it is not redrawn each second. */
function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [life] = useState(() => Date.parse(expiresAt) - Date.now());
  const left = Date.parse(expiresAt) - now;
  const expired = left <= 0;
  useEffect(() => {
    if (expired) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [expired]);
  return (
    <div className="pair-expiry">
      <div className="pair-meta pair-expiry__row">
        <span className="pair-waiting">
          <span className="pair-dot" aria-hidden="true" />
          {expired ? 'This code has expired.' : 'Waiting for a device'}
        </span>
        {!expired && <span>Expires in {clock(left)}</span>}
      </div>
      <div className="pair-bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, Math.max(0, (left / life) * 100))}%` }} />
      </div>
    </div>
  );
}

/** One code: asks the brain for it once, then shows it. A new code is a new instance (a new key). */
function PairCode({
  make,
  copyText,
  enableNetwork,
  onRetry,
  onClose,
}: Pick<PairDialogProps, 'make' | 'copyText' | 'enableNetwork' | 'onClose'> & {
  onRetry: () => void;
}) {
  const [result, setResult] = useState<PairOffer | 'failed' | 'network_off' | null>(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let live = true;
    make().then(
      (made) => live && setResult(made),
      (error: unknown) =>
        live &&
        setResult(
          enableNetwork !== undefined && String(error).includes('network_off')
            ? 'network_off'
            : 'failed',
        ),
    );
    return () => {
      live = false;
    };
  }, [make, enableNetwork]);

  if (result === 'network_off' && enableNetwork !== undefined) {
    return (
      <>
        <p className="pair-alert" role="status">
          <span>
            <strong>Other devices cannot reach this computer yet.</strong> Turn on "Let other
            devices connect" first. Scout keeps the link encrypted and checks every device against a
            code.
          </span>
        </p>
        <div className="pair-actions">
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Button
            variant="primary"
            disabled={enabling}
            onClick={() => {
              setEnabling(true);
              void enableNetwork().then((ok) => {
                setEnabling(false);
                if (ok) onRetry();
              });
            }}
          >
            Let other devices connect
          </Button>
        </div>
      </>
    );
  }
  if (result === 'failed' || result === 'network_off') {
    return (
      <p className="pair-alert pair-alert--err" role="alert">
        Scout could not make a code. Check that the brain is running, then make a new one.
      </p>
    );
  }
  if (result === null) return <p className="pair-meta">Making a code…</p>;
  return (
    <>
      <div className="pair-grid">
        <div className="pair-scan">
          <div className="pair-qrbox">
            <QrImage text={result.qr} label="Pairing QR code" />
          </div>
          <span className="pair-meta">Scan with the other device</span>
        </div>
        <div className="pair-link">
          <span className="pair-label">Or send this link</span>
          <div className="pair-copy">
            <code className="pair-code">{result.link}</code>
            <CopyButton text={result.link} copy={copyText} />
          </div>
        </div>
      </div>
      <Countdown expiresAt={result.expiresAt} />
    </>
  );
}

export function PairDialog({ make, copyText, onClose, enableNetwork }: PairDialogProps) {
  const [round, setRound] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="pair-scrim">
      <div className="pair-dialog" role="dialog" aria-modal="true" aria-label="Pair a device">
        <h2>Pair a device</h2>
        <PairCode
          key={round}
          make={make}
          copyText={copyText}
          onClose={onClose}
          {...(enableNetwork === undefined ? {} : { enableNetwork })}
          onRetry={() => setRound((n) => n + 1)}
        />
        <p className="pair-alert">
          Pair only devices you own. A paired device can use everything Scout knows. Revoke it any
          time in Devices.
        </p>
        <div className="pair-actions">
          <Button variant="quiet" onClick={() => setRound((n) => n + 1)}>
            Make a new code
          </Button>
          <Button variant="secondary" onClick={onClose} autoFocus>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
