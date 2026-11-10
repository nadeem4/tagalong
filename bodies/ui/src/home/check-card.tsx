/**
 * The check card shown before a community app or expert is connected: who made it, where it
 * runs, how it signs in, its licence, and that nobody has audited it. The brain sends the
 * facts; this lays them out. Contains CheckCard and the ExpertCardFacts shape.
 */
import type { AppRow } from '../shapes';
import { Button } from '../controls/button';

/** What a community expert row can say; the ACP registry gives no publisher or sign-in. */
export interface ExpertCardFacts {
  name: string;
  publisher: string;
  runs: 'pc';
  licence: string;
  repo: string;
}

const SIGN_IN = { browser: 'your browser', key: 'a key you paste', none: 'none needed' };

export function CheckCard({
  row,
  busy,
  onConnect,
  onBack,
}: {
  row: AppRow | ExpertCardFacts;
  busy: boolean;
  onConnect: () => void;
  onBack: () => void;
}) {
  const where =
    row.runs === 'hosted'
      ? `Hosted by ${'host' in row ? (row.host ?? 'a remote server') : ''}`
      : 'Runs on your PC';
  return (
    <div className="conn-check" role="group" aria-label="Check before connecting">
      <ul className="conn-check__facts">
        <li>Made by {row.publisher} (not the service itself)</li>
        <li>{where}</li>
        {'signIn' in row && <li>Sign-in: {SIGN_IN[row.signIn]}</li>}
        <li>Licence {row.licence === '' ? 'Unknown' : row.licence}</li>
        <li>Not yet audited by anyone</li>
      </ul>
      <p className="tg-note">Scout still asks you before each use.</p>
      <div className="home-conn__actions">
        {row.repo !== '' && (
          <a className="conn-check__link" href={row.repo} target="_blank" rel="noreferrer noopener">
            See its code
          </a>
        )}
        <Button variant="quiet" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" disabled={busy} onClick={onConnect}>
          Connect anyway
        </Button>
      </div>
    </div>
  );
}
