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

/** Only http(s) addresses become links: the registry's repo address is untrusted text. */
const isWeb = (url: string): boolean => /^https?:\/\//i.test(url);

/** Where it runs, in words; shared by the card and the row's preview line. */
export function whereText(row: Pick<AppRow, 'runs'> & { host?: string | null }): string {
  return row.runs === 'hosted' ? `hosted by ${row.host ?? 'a remote server'}` : 'your PC';
}

/** How you sign in, in words; absent for an expert (the registry says nothing). */
export function signInText(row: object): string | null {
  return 'signIn' in row ? SIGN_IN[(row as AppRow).signIn] : null;
}

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
  const signIn = signInText(row);
  return (
    <div className="conn-check" role="group" aria-label="Check before connecting">
      <ul className="conn-check__facts">
        <li>Made by {row.publisher} (not the service itself)</li>
        <li>Where it runs: {whereText(row)}</li>
        {signIn !== null && <li>Sign-in: {signIn}</li>}
        <li>Licence: {row.licence === '' ? 'Unknown' : row.licence}</li>
        <li>Reviewed: Not yet audited by anyone</li>
      </ul>
      <p className="tg-note">Scout still asks you before each use.</p>
      <div className="home-conn__actions">
        {isWeb(row.repo) && (
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
