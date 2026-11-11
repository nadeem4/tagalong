/**
 * The facts block of the check card: who made it, where it runs, its licence and that nobody has
 * checked it, plus a link to its code. What the brain does not know is left out, never printed as
 * "Unknown". Shared by Connections, the tour and the chat install card. Contains CheckFacts and
 * the ExpertFacts shape.
 */
import type { AppRow } from '../shapes';
import { whereLine } from './facts-line';
import { Icon } from './icons';

/** What a community expert row can say: the ACP registry gives no publisher or licence. */
export interface ExpertFacts {
  name: string;
}

/** Only http(s) addresses become links: the registry's repo address is untrusted text. */
const isWeb = (url: string): boolean => /^https?:\/\//i.test(url);

export function CheckFacts({ row }: { row: AppRow | ExpertFacts }) {
  if (!('publisher' in row)) {
    return (
      <ul className="cx-check__facts">
        <li className="cx-check__lead">The expert list doesn&apos;t say who made this or check it.</li>
        <li>{whereLine('pc')}</li>
      </ul>
    );
  }
  const licence = row.licence !== '' && row.licence !== 'Unknown' ? `Licence ${row.licence}` : null;
  const where = [whereLine(row.runs), licence].filter((part) => part !== null).join(' · ');
  return (
    <ul className="cx-check__facts">
      <li className="cx-check__lead">
        Made by {row.publisher}, not {row.name}
      </li>
      {where !== '' && <li>{where}</li>}
      <li>Nobody has checked this one yet</li>
      {isWeb(row.repo) && (
        <li>
          <a className="cx-link" href={row.repo} target="_blank" rel="noreferrer noopener">
            See its code
            <Icon name="external" />
          </a>
        </li>
      )}
    </ul>
  );
}
