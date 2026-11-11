/**
 * Scout's brain, on Overview: what it is, whether it runs, how old it is, who started it and
 * where it keeps things. Four states as drawn: running, update ready, started by you (no
 * restart offered), offline (Start brain, the app's own version, the unknown as a dash). The
 * first-run install lines live here too.
 */
import { useHostBridge, type BrainCard as BrainCardData } from '../host-bridge';
import { Button } from '../controls/button';
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

export function BrainCard() {
  const bridge = useHostBridge();
  const { card, setup } = useBrainCard();
  if (card === null) return null;
  const offline = card.status === 'offline';
  const person = card.startedBy === 'person';

  return (
    <section className="home-card brain-card" aria-label="Scout's brain">
      <h2 className="brain-card__title">Scout's brain</h2>
      <p>
        The part of Scout that thinks, remembers and runs your jobs. It keeps running when you close
        Tagalong.
      </p>
      {offline && setup === 'installing' && (
        <p>Setting up Scout's brain — one-time download. This can take a few minutes.</p>
      )}
      {offline && setup === 'failed' && (
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
      {offline && setup === 'idle' && (
        <div className="brain-error" role="alert">
          <ErrIcon />
          <span>Can't reach Scout's brain. Trying again every 2 s.</span>
          <Button variant="primary" onClick={() => void bridge.retryBrainSetup()}>
            Start brain
          </Button>
        </div>
      )}
      {!offline && card.update !== 'none' && <UpdatePrompt card={card} />}
      <Facts card={card} />
      <div className="brain-foot">
        {person && !offline && <p className="brain-foot__note">{LEAVES_IT_ALONE}</p>}
        {!offline && !person && card.update === 'none' && (
          <Button
            variant="secondary"
            onClick={() => void bridge.restartBrain().catch(() => undefined)}
          >
            Restart brain
          </Button>
        )}
        {offline && (
          <button type="button" className="brain-link" onClick={() => void bridge.openBrainLog()}>
            Open log
          </button>
        )}
        <Button variant="quiet" onClick={() => void bridge.copyBrainDetails()}>
          Copy details
        </Button>
      </div>
    </section>
  );
}
