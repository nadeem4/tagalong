/**
 * Scout's brain when it runs on another computer: its machine and link, and only what this PC
 * can do about it (no restart, no folders). Unreachable it offers Try now and the Tailscale
 * guide. Contains RemoteBrainCard.
 */
import { Button } from '../controls/button';
import { useHostBridge, type BrainCard as BrainCardData } from '../host-bridge';
import { ErrIcon } from './brain-icons';

export function RemoteBrainCard({ card, onAway }: { card: BrainCardData; onAway?: () => void }) {
  const bridge = useHostBridge();
  const machine = card.host ?? 'another computer';
  const offline = card.status === 'offline';
  return (
    <section className="tg-card brain-card" aria-label="Scout's brain">
      <h2 className="brain-card__title">Scout's brain</h2>
      <p>
        The part of Scout that thinks, remembers and runs your jobs. Here it lives on {machine}.
      </p>
      {offline && (
        <div className="brain-error" role="alert">
          <ErrIcon />
          <span>
            Can't reach {machine}. It may be asleep, switched off or on another network. Scout keeps
            trying every few seconds.
          </span>
        </div>
      )}
      <dl className={offline ? 'brain-facts brain-facts--dim' : 'brain-facts'}>
        <dt>Status</dt>
        <dd>
          <span className="brain-status">
            <span className={offline ? 'home-dot home-dot--warn' : 'home-dot'} aria-hidden="true" />
            {offline ? 'Not reachable' : 'Connected'}
          </span>
        </dd>
        <dt>Runs on</dt>
        <dd>{machine}</dd>
        <dt>Link</dt>
        <dd>
          Encrypted · <span className="brain-mono">{card.addr.replace(/:\d+$/, '')}</span>
        </dd>
        {!offline && (
          <>
            <dt>Version</dt>
            <dd>{card.version === null ? '—' : `Tagalong ${card.version}`}</dd>
          </>
        )}
      </dl>
      <div className="brain-foot">
        {offline ? (
          <>
            <Button variant="primary" onClick={() => void bridge.reconnectBrain()}>
              Try now
            </Button>
            {onAway !== undefined && (
              <Button variant="secondary" onClick={onAway}>
                Away from home?
              </Button>
            )}
          </>
        ) : (
          <p className="brain-foot__note">
            To restart, stop or update the brain, open Home on {machine}.
          </p>
        )}
        <Button variant="quiet" onClick={() => void bridge.forgetBrain()}>
          Use a different brain
        </Button>
      </div>
    </section>
  );
}
