/**
 * The "For long jobs" group on Home's Connections page: one row per installed expert, led by the
 * kind of job it does with the product underneath, then its state and the action that fits it
 * (Log in, Update), plus the stage words of a running install.
 * Contains ExpertsGroup and stageWords. The brain sends short tokens; the words are this page's.
 */

import type { SetupExpert, SetupOverview } from '../shapes';
import { Button } from '../controls/button';
import { DEFAULT_EXPERT_JOB, EXPERT_JOB } from '../jobs-kinds';

const STATE_WORDS: Record<SetupExpert['state'], string> = {
  ready: 'Ready',
  needs_login: 'Needs login',
  needs_update: 'Update available',
};
const STATE_CHIP: Record<SetupExpert['state'], string> = {
  ready: 'tg-chip tg-chip--ok',
  needs_login: 'tg-chip tg-chip--warn',
  needs_update: 'tg-chip tg-chip--warn',
};
const ACTION: Partial<Record<SetupExpert['state'], string>> = {
  needs_login: 'Log in',
  needs_update: 'Update',
};
const STAGES: Record<string, string> = {
  checking: 'Checking this computer',
  node: 'Getting Tagalong’s own Node',
  installing: 'Installing',
  downloading: 'Downloading',
  extracting: 'Unpacking',
  done: 'Finishing up',
};

/** "Installing 40%": the stage in this page's words, with a percent when the brain gave one. */
export function stageWords(progress: NonNullable<SetupOverview['progress']>): string {
  const words = STAGES[progress.stage] ?? 'Working';
  return progress.percent === undefined ? words : `${words} ${progress.percent}%`;
}

export function ExpertsGroup({
  experts,
  progress,
  asking,
  onAct,
}: {
  experts: SetupExpert[];
  progress: SetupOverview['progress'];
  /** Ids waiting on the person's answer to an Allow card. */
  asking: ReadonlySet<string>;
  onAct: (id: string) => void;
}) {
  return (
    <section className="home-card" aria-label="For long jobs">
      <h2 className="home-card__label">For long jobs</h2>
      {experts.length === 0 ? (
        <p className="tg-note">No experts yet. Add one below.</p>
      ) : (
        <ul aria-label="Installed experts" className="home-list home-conns__list">
          {experts.map((expert) => {
            const working = progress?.expert === expert.id || asking.has(expert.id);
            const action = ACTION[expert.state];
            return (
              <li key={expert.id}>
                <section className="home-conn" aria-label={expert.name}>
                  <div className="home-conn__head">
                    <span className="home-conn__initial" aria-hidden="true">
                      {expert.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="home-entry__body">
                      <span className="home-entry__title">
                        {EXPERT_JOB[expert.id] ?? DEFAULT_EXPERT_JOB}
                      </span>
                      <span className="home-entry__preview" title={expert.name}>
                        {expert.name} ·{' '}
                        {expert.version === '' ? 'Your own command' : `Version ${expert.version}`}
                      </span>
                    </span>
                    {!expert.tested && <span className="tg-chip">Untested</span>}
                    <span className={STATE_CHIP[expert.state]}>{STATE_WORDS[expert.state]}</span>
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
                  </div>
                  {progress?.expert === expert.id && (
                    <p className="tg-note" role="status">
                      {stageWords(progress)}
                    </p>
                  )}
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
