/**
 * The facts block of the check card: who made it, where it runs, its licence and that nobody has
 * checked it, plus a link to its code. What the brain does not know is left out, never printed as
 * "Unknown". Shared by Connections, the tour and the chat install card. Contains CheckFacts and
 * the ExpertFacts shape.
 */
import type { AppRow } from '../shapes';
import { whereLine } from './facts-line';
import { Icon } from './icons';

/** What a community expert row can say: the ACP registry gives no publisher, only a licence and a code address. */
export interface ExpertFacts {
  name: string;
  licence?: string;
  repo?: string;
}

/** Only http(s) addresses become links: the registry's repo address is untrusted text. */
const isWeb = (url: string): boolean => /^https?:\/\//i.test(url);

function CodeLink({ repo }: { repo: string }) {
  if (!isWeb(repo)) return null;
  return (
    <li>
      <a className="cx-link" href={repo} target="_blank" rel="noreferrer noopener">
        See its code
        <Icon name="external" />
      </a>
    </li>
  );
}

/** "Licence MIT", or null when the registry has none (never "Unknown"). */
const licenceLine = (licence: string | undefined): string | null =>
  licence !== undefined && licence !== '' && licence !== 'Unknown' ? `Licence ${licence}` : null;

export function CheckFacts({ row }: { row: AppRow | ExpertFacts }) {
  if (!('publisher' in row)) {
    const where = [whereLine('pc'), licenceLine(row.licence)].filter((part) => part !== null);
    return (
      <ul className="cx-check__facts">
        <li className="cx-check__lead">
          The expert list doesn&apos;t say who made this or check it.
        </li>
        <li>{where.join(' · ')}</li>
        <CodeLink repo={row.repo ?? ''} />
      </ul>
    );
  }
  const where = [whereLine(row.runs), licenceLine(row.licence)]
    .filter((part) => part !== null)
    .join(' · ');
  return (
    <ul className="cx-check__facts">
      <li className="cx-check__lead">
        Made by {row.publisher}, not {row.name}
      </li>
      {where !== '' && <li>{where}</li>}
      <li>Nobody has checked this one yet</li>
      <CodeLink repo={row.repo} />
    </ul>
  );
}
