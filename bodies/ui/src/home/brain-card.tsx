/**
 * Scout's brain, on Overview: what it is, whether it runs, how old it is, who started it and
 * where it keeps things. Four states as drawn: running, update ready, started by you (no
 * restart offered), offline (Start brain, the app's own version, the unknown as a dash). A brain
 * on another computer (`local` false) is the same card with only what this PC can do about it:
 * its machine and link, Try now and the Tailscale guide when unreachable, no restart or folders.
 * The first-run install lines live here too.
 */
import { useState } from 'react';
import { useHostBridge, type BrainCard as BrainCardData } from '../host-bridge';
import { Button } from '../controls/button';
import { HostPairDialog } from '../pair/host-pair-dialog';
import { ErrIcon } from './brain-icons';
import { LEAVES_IT_ALONE, UpdatePrompt } from './update-banner';
import { useBrainCard } from './use-brain-card';

const DASH = '—';

/** "Up 25 min", "Up 3 h 12 min"; a brain younger than a minute is "Up under 1 min". */
function uptime(startedAt: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(startedAt)) / 60_000);
  if (!(minutes >= 1)) return 'Up under 1 min';
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `Up ${hours} h ${minutes % 60} min` : `Up ${minutes} min`;
}

const isLocal = (addr: string): boolean => /^(127\.0\.0\.1|localhost|\[?::1\]?):/.test(addr);
const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Facts({ card }: { card: BrainCardData }) {
  const bridge = useHostBridge();
  const offline = card.status === 'offline';
  if (card.local === false) {
    return (
      <dl className={offline ? 'brain-facts brain-facts--dim' : 'brain-facts'}>
        <Row label="Status">
          <span className="brain-status">
            <span className={offline ? 'home-dot home-dot--warn' : 'home-dot'} aria-hidden="true" />
            {offline ? 'Not reachable' : 'Connected'}
          </span>
        </Row>
        <Row label="Runs on">{card.host ?? 'another computer'}</Row>
        <Row label="Link">
          Encrypted · <span className="brain-mono">{card.addr.replace(/:\d+$/, '')}</span>
        </Row>
        {!offline && (
          <Row label="Version">{card.version === null ? DASH : `Tagalong ${card.version}`}</Row>
        )}
      </dl>
    );
  }
  const stale = card.update !== 'none';
  const dot = offline ? 'home-dot home-dot--off' : stale ? 'home-dot home-dot--warn' : 'home-dot';
  const status = offline
    ? 'Offline · Reconnecting'
    : stale
      ? 'Running · Update ready'
      : `Running · ${card.startedAt === null ? 'Up' : uptime(card.startedAt)}`;
  // Offline the desktop is the one that will start it, so it names itself, as drawn.
  const startedBy =
    card.startedBy === 'person'
      ? 'You, from a terminal'
      : card.startedBy === null && !offline
        ? DASH
        : 'Tagalong';
  const own = `Tagalong ${card.appVersion} · build ${card.appBuild}`;
  const theirs = `Brain ${card.version ?? 'of unknown version'}${card.build === null ? '' : ` · build ${card.build}`}`;
  const version = offline ? (
    own
  ) : stale ? (
    <>
      {theirs}{' '}
      <span className="brain-meta">
        (app is {card.appVersion} · {card.appBuild})
      </span>
    </>
  ) : card.version === null ? (
    DASH
  ) : (
    `Tagalong ${card.version}${card.build === null ? '' : ` · build ${card.build}`}`
  );
  return (
    <dl className={offline ? 'brain-facts brain-facts--dim' : 'brain-facts'}>
      <Row label="Status">
        <span className="brain-status">
          <span className={dot} aria-hidden="true" />
          {status}
        </span>
      </Row>
      <Row label="Where">
        {isLocal(card.addr) ? 'This PC · ' : ''}
        <span className="brain-mono">{card.addr}</span>
      </Row>
      <Row label="Version">{version}</Row>
      <Row label="Model">{card.model ?? DASH}</Row>
      <Row label="Started by">{startedBy}</Row>
      <Row label="Process ID">
        <span className="brain-mono">{card.pid ?? DASH}</span>
      </Row>
      <Row label="Data folder">
        <span className="brain-mono">{card.dataDir}</span>
        <button type="button" className="brain-link" onClick={() => void bridge.openBrainFolder()}>
          Open folder
        </button>
      </Row>
      <Row label="Log file">
        <span className="brain-mono">{fileName(card.logPath)}</span>
        <button type="button" className="brain-link" onClick={() => void bridge.openBrainLog()}>
          Open log
        </button>
      </Row>
      <Row label="Places connected">
        {offline || card.places.length === 0 ? (
          `None${offline ? ' while offline' : ''}`
        ) : (
          <>
            {card.places.length} ·{' '}
            <span className="brain-chips">
              {card.places.map((place) => (
                <span key={place.id} className="tg-chip">
                  {place.name}
                </span>
              ))}
            </span>
          </>
        )}
      </Row>
    </dl>
  );
}

export function BrainCard({ onAway }: { onAway?: () => void }) {
  const bridge = useHostBridge();
  const { card, setup, refresh } = useBrainCard();
  const [pairing, setPairing] = useState(false);
  const [serviceFailed, setServiceFailed] = useState(false);
  if (card === null) return null;
  const remote = card.local === false;
  const machine = card.host ?? 'another computer';
  const offline = card.status === 'offline';
  const person = card.startedBy === 'person';
  const service = card.startedBy === 'service';
  const makeService = async (): Promise<void> => {
    const outcome = await bridge.installBrainService();
    setServiceFailed(!outcome.ok);
    refresh();
  };

  return (
    <section className="tg-card brain-card" aria-label="Scout's brain">
      <h2 className="brain-card__title">Scout's brain</h2>
      <p>
        The part of Scout that thinks, remembers and runs your jobs.{' '}
        {remote ? `Here it lives on ${machine}.` : 'It keeps running when you close Tagalong.'}
      </p>
      {offline && remote && (
        <div className="brain-error" role="alert">
          <ErrIcon />
          <span>
            Can't reach {machine}. It may be asleep, switched off or on another network. Scout keeps
            trying every few seconds.
          </span>
        </div>
      )}
      {offline && !remote && setup === 'installing' && (
        <p>Setting up Scout's brain — one-time download. This can take a few minutes.</p>
      )}
      {offline && !remote && setup === 'failed' && (
        <div className="brain-error" role="alert">
          <ErrIcon />
          <span>
            Scout's brain did not finish setting up. Check your internet connection, then retry.
          </span>
          <Button variant="primary" onClick={() => void bridge.retryBrainSetup()}>
            Retry
          </Button>
        </div>
      )}
      {offline && !remote && setup === 'idle' && (
        <div className="brain-error" role="alert">
          <ErrIcon />
          <span>Can't reach Scout's brain. Trying again every 2 s.</span>
          <Button variant="primary" onClick={() => void bridge.retryBrainSetup()}>
            Start brain
          </Button>
        </div>
      )}
      {!offline && !remote && card.update !== 'none' && <UpdatePrompt card={card} />}
      <Facts card={card} />
      {!offline && !remote && !service && (
        <div className="brain-service">
          <span>
            <strong>Make this computer Scout's brain</strong>
            <span className="brain-meta">
              Starts it when you sign in and keeps it running, so your other devices can reach it.
            </span>
          </span>
          <Button variant="secondary" onClick={() => void makeService()}>
            Make this Scout's brain
          </Button>
        </div>
      )}
      {serviceFailed && (
        <p role="alert" className="brain-foot__note">
          Scout could not set that up. Try again, or run "tagalong service install" in a terminal.
        </p>
      )}
      {pairing && <HostPairDialog host={bridge} onClose={() => setPairing(false)} />}
      <div className="brain-foot">
        {remote && offline && (
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
        )}
        {remote && !offline && (
          <p className="brain-foot__note">
            To restart, stop or update the brain, open Home on {machine}.
          </p>
        )}
        {remote && (
          <Button variant="quiet" onClick={() => void bridge.forgetBrain()}>
            Use a different brain
          </Button>
        )}
        {!remote && service && !offline && (
          <Button variant="secondary" onClick={() => setPairing(true)}>
            Pair a device
          </Button>
        )}
        {!remote && person && !offline && <p className="brain-foot__note">{LEAVES_IT_ALONE}</p>}
        {!remote && !offline && !person && card.update === 'none' && (
          <Button
            variant="secondary"
            onClick={() => void bridge.restartBrain().catch(() => undefined)}
          >
            Restart brain
          </Button>
        )}
        {!remote && offline && (
          <button type="button" className="brain-link" onClick={() => void bridge.openBrainLog()}>
            Open log
          </button>
        )}
        {!remote && (
          <Button variant="quiet" onClick={() => void bridge.copyBrainDetails()}>
            Copy details
          </Button>
        )}
      </div>
    </section>
  );
}
