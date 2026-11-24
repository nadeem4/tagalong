/**
 * "Pair a device": the QR, link and time left of a fresh pairing code made on this PC's brain,
 * for another device to scan or paste. Opens from the tour's finish card. Contains PairDialog.
 */

import { useEffect, useState } from 'react';
import { Button } from '../controls';
import type { PairOffer } from '../walkthrough/walkthrough-host';
import { QrImage } from './qr-image';

const CODE_LIFE_MS = 10 * 60 * 1000;

interface PairDialogProps {
  make: () => Promise<PairOffer>;
  copyText: (text: string) => Promise<void>;
  onClose: () => void;
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function PairDialog({ make, copyText, onClose }: PairDialogProps) {
  const [offer, setOffer] = useState<PairOffer | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    make().then(
      (made) => live && setOffer(made),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [make, attempt]);
  const again = (): void => {
    setOffer(null);
    setFailed(false);
    setAttempt((n) => n + 1);
  };
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const left = offer === null ? 0 : Date.parse(offer.expiresAt) - now;
  const expired = offer !== null && left <= 0;

  return (
    <div className="pair-scrim">
      <div className="pair-dialog" role="dialog" aria-modal="true" aria-label="Pair a device">
        <h2>Pair a device</h2>
        {failed ? (
          <p className="pair-alert pair-alert--err" role="alert">
            Scout could not make a code. Check that the brain is running, then make a new one.
          </p>
        ) : offer === null ? (
          <p className="pair-meta">Making a code…</p>
        ) : (
          <>
            <div className="pair-grid">
              <div className="pair-scan">
                <div className="pair-qrbox">
                  <QrImage text={offer.qr} label="Pairing QR code" />
                </div>
                <span className="pair-meta">Scan with the other device</span>
              </div>
              <div className="pair-link">
                <span className="pair-label">Or send this link</span>
                <div className="pair-copy">
                  <code className="pair-code">{offer.link}</code>
                  <Button
                    variant="secondary"
                    onClick={() => void copyText(offer.link).catch(() => undefined)}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </div>
            <div className="pair-expiry">
              <div className="pair-meta pair-expiry__row">
                <span className="pair-waiting">
                  <span className="pair-dot" aria-hidden="true" />
                  {expired ? 'This code has expired.' : 'Waiting for a device'}
                </span>
                {!expired && <span>Expires in {clock(left)}</span>}
              </div>
              <div className="pair-bar" aria-hidden="true">
                <i
                  style={{ width: `${Math.min(100, Math.max(0, (left / CODE_LIFE_MS) * 100))}%` }}
                />
              </div>
            </div>
          </>
        )}
        <p className="pair-alert">
          Pair only devices you own. A paired device can use everything Scout knows. Revoke it any
          time in Devices.
        </p>
        <div className="pair-actions">
          <Button variant="quiet" onClick={again}>
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
