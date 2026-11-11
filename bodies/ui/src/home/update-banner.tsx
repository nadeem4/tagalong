/**
 * "Update ready": Scout's brain is older than the app. `UpdatePrompt` is the warning block with
 * its actions (the brain card and the banner both draw it); `UpdateBanner` puts it at the top
 * of every Home page, only when there is an update. A brain the person started gets words, not
 * buttons: Tagalong never restarts it.
 */
import { useState } from 'react';
import { useHostBridge, type BrainCard } from '../host-bridge';
import { Button } from '../controls/button';
import { useBrainCard } from './use-brain-card';

export function UpdatePrompt({ card }: { card: BrainCard }) {
  const bridge = useHostBridge();
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const mine = card.update === 'ready';

  return (
    <div className="brain-update" role="status">
      <p className="brain-update__title">Update ready</p>
      <p>
        {mine
          ? "Scout's brain is from an older version. Restart to finish updating."
          : "Scout's brain is from an older version. Restart it in your terminal to finish updating."}
      </p>
      {mine && (
        <div className="brain-update__foot">
          {card.workRunning && (
            <p className="brain-update__note">
              Claude Code is running a job. Restarting now stops it.
            </p>
          )}
          {failed && <p className="brain-update__note">Scout could not restart the brain.</p>}
          {waiting && <p className="brain-update__note">It restarts when your job finishes.</p>}
          {card.workRunning && !waiting && (
            <Button
              variant="secondary"
              onClick={() => {
                setWaiting(true);
                void bridge.restartBrainAfterWork().catch(() => setFailed(true));
              }}
            >
              When your job finishes
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => {
              setFailed(false);
              void bridge.restartBrain().catch(() => setFailed(true));
            }}
          >
            Restart now
          </Button>
        </div>
      )}
    </div>
  );
}

export function UpdateBanner() {
  const { card } = useBrainCard();
  if (card === null || card.update === 'none') return null;
  return <UpdatePrompt card={card} />;
}
