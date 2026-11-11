/**
 * "Your experts" on Home's Connections page: the installed experts grouped Official then
 * Community, each with its version and the kind of job it does, its state and the action that
 * fits it (Sign in, Update). Also the pieces both expert lists share: the install progress block
 * and the "didn't finish" line. Contains ExpertsGroup, ProgressBlock and FailLine.
 * The brain sends short tokens; the words are this page's.
 */

import type { SetupExpert, SetupOverview } from '../shapes';
import { Button } from '../controls/button';
import { DEFAULT_EXPERT_JOB, EXPERT_JOB } from '../jobs-kinds';
import { OutcomeText, Tile } from './app-group-row';
import type { Outcome } from './outcome';

const STATE_WORDS: Record<SetupExpert['state'], string> = {
  ready: 'Ready',
  needs_login: 'Needs sign-in',
  needs_update: 'Update available',
};
const ACTION: Partial<Record<SetupExpert['state'], string>> = {
  needs_login: 'Sign in',
  needs_update: 'Update',
};
const STAGES: Record<string, string> = {
  checking: 'Checking this computer',
  node: 'Getting what it needs to run',
  installing: 'Installing',
  downloading: 'Downloading',
  extracting: 'Unpacking',
  done: 'Finishing up',
};

type Progress = NonNullable<SetupOverview['progress']>;

/** An install under way: its percent, a bar, and what it is doing now. */
export function ProgressBlock({ progress }: { progress: Progress }) {
  const { percent } = progress;
  return (
    <div className="cx-progress">
      <div className="cx-progress__top">
        <span>Installing…</span>
        {percent !== undefined && <span>{percent}%</span>}
      </div>
      {percent !== undefined && (
        <div
          className="cx-bar"
          role="progressbar"
          aria-label="Installing"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <i style={{ width: `${percent}%` }} />
        </div>
      )}
      <span className="cx-meta">{STAGES[progress.stage] ?? 'Working'}</span>
    </div>
  );
}

/** Setup that did not finish, on the row it happened to. */
export function FailLine({ name, onRetry }: { name: string; onRetry: () => void }) {
  return (
    <div className="cx-errline" role="alert">
      Setting up {name} didn&apos;t finish.
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function ExpertsGroup({
  experts,
  progress,
  asking,
  outcomes,
  failedId,
  onAct,
}: {
  experts: SetupExpert[];
  progress: SetupOverview['progress'];
  /** Ids waiting on the person's answer to an Allow card. */
  asking: ReadonlySet<string>;
  outcomes: ReadonlyMap<string, Outcome>;
  /** The expert whose setup did not finish, if one did not. */
  failedId: string | null;
  onAct: (id: string) => void;
}) {
  const row = (expert: SetupExpert) => {
    const working = progress?.expert === expert.id || asking.has(expert.id);
    const action = ACTION[expert.state];
    const outcome = outcomes.get(expert.id);
    return (
      <li key={expert.id} className="cx-item">
        <section className="cx-row" aria-label={expert.name}>
          <Tile name={expert.name} />
          <div className="cx-row__main">
            <span className="cx-row__name" title={expert.name}>
              {expert.name}
              {!expert.tested && (
                <span className="cx-chip cx-chip--quiet">Not tested with Scout</span>
              )}
            </span>
            <span className="cx-meta">
              {expert.version === '' ? 'Your own command' : `v${expert.version}`} ·{' '}
              {EXPERT_JOB[expert.id] ?? DEFAULT_EXPERT_JOB}
            </span>
          </div>
          <div className="cx-row__side">
            {outcome !== undefined && <OutcomeText outcome={outcome} />}
            {progress?.expert === expert.id ? (
              <ProgressBlock progress={progress} />
            ) : (
              <>
                <span className="cx-status">{STATE_WORDS[expert.state]}</span>
                {action !== undefined && (
                  <Button
                    variant="primary"
                    aria-label={action}
                    disabled={working}
                    onClick={() => onAct(expert.id)}
                  >
                    {action}
                  </Button>
                )}
              </>
            )}
          </div>
        </section>
        {failedId === expert.id && <FailLine name={expert.name} onRetry={() => onAct(expert.id)} />}
      </li>
    );
  };

  const official = experts.filter((expert) => expert.official);
  const community = experts.filter((expert) => !expert.official);
  return (
    <section className="home-card" aria-label="Your experts">
      <h2 className="home-card__label">Your experts</h2>
      {experts.length === 0 && <p className="tg-note">No experts yet. Add one below.</p>}
      {official.length > 0 && (
        <>
          <p className="cx-group-label">Official</p>
          <ul aria-label="Official experts" className="cx-list">
            {official.map(row)}
          </ul>
        </>
      )}
      {community.length > 0 && (
        <>
          <p className="cx-group-label">Community</p>
          <ul aria-label="Community experts" className="cx-list">
            {community.map(row)}
          </ul>
        </>
      )}
    </section>
  );
}
