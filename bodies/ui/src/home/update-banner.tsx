/**
 * "Update ready": Scout's brain is older than the app. `UpdatePrompt` is the warning block with
 * its actions (the brain card and the banner both draw it); `UpdateBanner` puts it at the top
 * of every Home page, only when there is an update. A brain the person started gets words, not
 * buttons: Tagalong never restarts it.
 */
import { useState } from 'react';
import { useHostBridge, type BrainCard } from '../host-bridge';
import { Button } from '../controls/button';
import { AlertIcon } from './brain-icons';
import { useBrainCard } from './use-brain-card';

export const LEAVES_IT_ALONE =
  'You started it, so Tagalong leaves it alone. Restart it in your terminal.';

/** `withNote`: the banner says why there is no button; the card says it in its own footer. */
export function UpdatePrompt({ card, withNote }: { card: BrainCard; withNote?: boolean }) {
  const bridge = useHostBridge();
  const [waiting, setWaiting] = useState(false);
  const mine = card.update === 'ready';

  return (
    <div className="brain-update" role="status">
      <p className="brain-update__title">
        <AlertIcon />
        Update ready
      </p>
      <p>Scout's brain is from an older version. Restart to finish updating.</p>
      {mine && (
        <div className="brain-update__foot">
          {card.workRunning && (
            <p className="brain-update__note">
              Claude Code is running a job. Restarting now stops it.
            </p>
          )}
          {card.workRunning && (
            <Button
              variant="secondary"
              disabled={waiting}
              onClick={() => {
                setWaiting(true);
                void bridge.restartBrainAfterWork().catch(() => setWaiting(false));
              }}
            >
              When your job finishes
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => void bridge.restartBrain().catch(() => undefined)}
          >
            Restart now
          </Button>
        </div>
      )}
      {!mine && withNote === true && <p className="brain-update__note">{LEAVES_IT_ALONE}</p>}
    </div>
  );
}

export function UpdateBanner() {
  const { card } = useBrainCard();
  if (card === null || card.update === 'none') return null;
  return <UpdatePrompt card={card} withNote />;
}
