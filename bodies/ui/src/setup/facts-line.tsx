/**
 * The short meta line under an app or expert row: where it runs and how it signs in, for example
 * "Runs on your PC · Browser sign-in". Never says who made it: the Official or Community chip and
 * the check card do that. Shared by Connections, the tour and the chat install card.
 * Contains FactsLine and whereLine.
 */
import type { AppRow } from '../shapes';

const SIGN_IN: Record<AppRow['signIn'], string> = {
  browser: 'Browser sign-in',
  key: 'Key you paste',
  none: 'No sign-in',
};

/** What an expert row can say: the registry gives no sign-in, so `account` is the curated claim. */
export type ExpertLine = { runs: 'pc'; account: boolean };

/** "Runs on your PC" or "Runs on the web"; null when the brain does not know. */
export function whereLine(runs: 'pc' | 'hosted' | null): string | null {
  if (runs === null) return null;
  return runs === 'hosted' ? 'Runs on the web' : 'Runs on your PC';
}

export function FactsLine({ row }: { row: AppRow | ExpertLine }) {
  const sign =
    'signIn' in row ? SIGN_IN[row.signIn] : row.account ? 'Signs in with your own account' : null;
  const parts = [whereLine(row.runs), sign].filter((part) => part !== null);
  return <span className="cx-meta">{parts.join(' · ')}</span>;
}
