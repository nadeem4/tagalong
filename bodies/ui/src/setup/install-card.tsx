/**
 * The one install card: asking to add an app or an expert, working on it, done, failed, and the
 * expert's sign in. The chat draws it on navy; Connections draws the same card on light for a
 * running install, so the two never drift. Presentational: the caller owns the state.
 * Contains InstallCard, subjectOf, INSTALL_CARD_CSS and the InstallSubject and InstallView types.
 */
import { themeTokens as t, typeCss } from '../theme/tokens';

export interface InstallSubject {
  kind: 'app' | 'expert';
  /** The registry id: what the brain installs and what its progress is keyed by. */
  id: string;
  name: string;
  official: boolean;
  recommended?: boolean;
  madeBy?: string;
  runs?: 'hosted' | 'pc';
  signIn?: 'browser' | 'key' | 'none' | 'account';
  licence?: string;
  repo?: string;
}

export interface InstallStep {
  label: string;
  state: 'done' | 'now' | 'fail' | 'todo';
}

export type InstallView =
  | { phase: 'ask' }
  | {
      phase: 'working';
      steps?: InstallStep[];
      /** The heading when there are no steps ("Downloading…"). */
      label?: string;
      percent?: number;
      note?: string;
    }
  | { phase: 'signin' }
  | { phase: 'done'; tools?: string[]; tryPrompts?: string[] }
  | { phase: 'failed'; error: string; steps?: InstallStep[] };

export interface InstallCardProps {
  subject: InstallSubject;
  view: InstallView;
  /** Navy in the chat, light on the Connections page. */
  theme?: 'navy' | 'light';
  onAllow?: () => void;
  onNotNow?: () => void;
  onRetry?: () => void;
  onSignIn?: () => void;
  onLater?: () => void;
  onManage?: () => void;
  onTry?: (prompt: string) => void;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** "app.notion/mcp" is Notion; "claude-acp" is Claude. The brain's own name replaces it when known. */
function nameFromId(id: string): string {
  const parts = id.split('/');
  const strip = (s: string) => s.replace(/(^mcp-|[-_]?(mcp|acp|server)$)/g, '');
  let base = strip(parts[parts.length - 1] ?? '');
  if (base === '' && parts.length > 1) base = (parts[0] ?? '').split('.').pop() ?? '';
  if (base === '') base = id;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** The card's facts from an install ask's `input` (see the brain's app_card and install_card). */
export function subjectOf(
  tool: 'install_app' | 'install_expert' | string,
  facts: Record<string, unknown>,
): InstallSubject {
  if (tool === 'install_expert') {
    const id = str(facts.expert) ?? 'expert';
    return {
      kind: 'expert',
      id,
      name: nameFromId(id),
      official: facts.official === true,
      madeBy: str(facts.publisher),
      runs: 'pc',
      signIn: 'account',
    };
  }
  const id = str(facts.app) ?? 'app';
  const runs = facts.runs === 'hosted' || facts.runs === 'pc' ? facts.runs : undefined;
  const signIn =
    facts.sign_in === 'browser' || facts.sign_in === 'key' || facts.sign_in === 'none'
      ? facts.sign_in
      : undefined;
  const publisher = str(facts.publisher);
  return {
    kind: 'app',
    id,
    name: str(facts.name) ?? (facts.official === true && publisher ? publisher : nameFromId(id)),
    official: facts.official === true,
    ...(publisher !== undefined ? { madeBy: publisher } : {}),
    ...(runs !== undefined ? { runs } : {}),
    ...(signIn !== undefined ? { signIn } : {}),
    ...(str(facts.licence) !== undefined ? { licence: str(facts.licence)! } : {}),
    ...(str(facts.repo) !== undefined ? { repo: str(facts.repo)! } : {}),
  };
}

const SIGN_IN: Record<NonNullable<InstallSubject['signIn']>, string | null> = {
  browser: 'Browser sign-in',
  key: 'Needs a key',
  none: null,
  account: 'Your own account',
};

function metaLine(s: InstallSubject): string {
  const parts = [
    s.madeBy === undefined ? null : `${s.official ? 'Made by' : 'By'} ${s.madeBy}`,
    s.runs === undefined ? null : s.runs === 'hosted' ? 'Runs on the web' : 'Runs on your PC',
    s.signIn === undefined ? null : SIGN_IN[s.signIn],
  ];
  return parts.filter((p): p is string => p !== null).join(' · ');
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none">
      <path d="m3.5 8.5 3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function Cross() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none">
      <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Steps({ steps }: { steps: InstallStep[] }) {
  return (
    <ul className="sc-steps" aria-label="Steps">
      {steps.map((step) => (
        <li key={step.label} className={`is-${step.state}`}>
          <span className={`st st--${step.state}`} aria-hidden="true">
            {step.state === 'done' ? <Tick /> : step.state === 'fail' ? <Cross /> : null}
            {step.state === 'now' && <span className="spin-n" />}
          </span>
          {step.label}
        </li>
      ))}
    </ul>
  );
}

function Bar({ percent }: { percent: number }) {
  return (
    <div
      className="sc-bar"
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

export function InstallCard({
  subject,
  view,
  theme = 'navy',
  onAllow,
  onNotNow,
  onRetry,
  onSignIn,
  onLater,
  onManage,
  onTry,
}: InstallCardProps) {
  const community = subject.kind === 'app' && !subject.official;
  const meta = metaLine(subject);
  const done = view.phase === 'done';
  return (
    <div className={`sc sc--${theme}`} role="group" aria-label={`Set up ${subject.name}`}>
      <style>{INSTALL_CARD_CSS}</style>
      <div className="sc-top">
        <span className="sc-tile" aria-hidden="true">
          {subject.name.charAt(0).toUpperCase()}
        </span>
        <div className="sc-id">
          <span className="sc-name">
            {subject.name}
            {subject.official ? (
              <span className="sc-chip sc-chip--ok">Official</span>
            ) : community ? (
              <span className="sc-chip">Community</span>
            ) : null}
            {subject.recommended === true && (
              <span className="sc-chip sc-chip--gold">Recommended</span>
            )}
          </span>
          {done ? (
            <span className="sc-ok">
              <Tick />
              {subject.kind === 'expert' ? 'Ready' : 'Connected'}
            </span>
          ) : (
            meta !== '' && <span className="sc-meta">{meta}</span>
          )}
        </div>
      </div>

      {view.phase === 'ask' && (
        <>
          <p className="sc-what">
            {subject.kind === 'expert'
              ? `Scout can hand ${subject.name} code fixes and other long jobs.`
              : `Scout will be able to read and update your ${subject.name} data. It asks before changing anything.`}
          </p>
          {community && (
            <div className="sc-check">
              <span className="sc-check-t">Check first</span>
              <ul>
                <li>The app list doesn&apos;t say who made this or check it.</li>
                <li>
                  {[
                    subject.runs === 'hosted' ? 'Runs on the web' : 'Runs on your PC',
                    `Licence ${subject.licence ?? 'Unknown'}`,
                  ].join(' · ')}
                </li>
              </ul>
              {subject.repo !== undefined && (
                <a className="sc-link" href={subject.repo} target="_blank" rel="noreferrer">
                  See its code
                </a>
              )}
            </div>
          )}
          <div className="sc-actions">
            <button type="button" className="sc-btn sc-btn--ghost" onClick={onNotNow}>
              Not now
            </button>
            <button type="button" className="sc-btn sc-btn--gold" onClick={onAllow}>
              {community ? 'Allow anyway' : 'Allow'}
            </button>
          </div>
        </>
      )}

      {view.phase === 'working' && (
        <>
          {view.steps !== undefined && <Steps steps={view.steps} />}
          {view.percent !== undefined && (
            <div className="sc-prog">
              <div className="sc-prog-top">
                <span>{view.label ?? ''}</span>
                <span>{view.percent}%</span>
              </div>
              <Bar percent={view.percent} />
            </div>
          )}
          {view.percent === undefined && view.steps === undefined && view.label !== undefined && (
            <p className="sc-what" role="status">
              {view.label}
            </p>
          )}
          {view.note !== undefined && <p className="sc-note">{view.note}</p>}
        </>
      )}

      {view.phase === 'signin' && (
        <>
          <p className="sc-what">
            Installed. Sign in once with your own Claude account; Scout never sees your password.
          </p>
          <div className="sc-actions">
            <button type="button" className="sc-btn sc-btn--ghost" onClick={onLater}>
              Later
            </button>
            <button type="button" className="sc-btn sc-btn--gold" onClick={onSignIn}>
              Sign in
            </button>
          </div>
        </>
      )}

      {view.phase === 'done' && (
        <>
          <p className="sc-what">
            <b>{subject.name} is ready.</b>{' '}
            {subject.kind === 'expert'
              ? 'Scout can hand it code fixes and other long jobs.'
              : `Scout can now use ${subject.name}.`}
          </p>
          {view.tools !== undefined && view.tools.length > 0 && (
            <details className="sc-disc">
              <summary>
                {view.tools.length} {view.tools.length === 1 ? 'thing' : 'things'} Scout can do
              </summary>
              <ul>
                {view.tools.map((tool) => (
                  <li key={tool}>{tool}</li>
                ))}
              </ul>
            </details>
          )}
          {view.tryPrompts !== undefined && view.tryPrompts.length > 0 && (
            <div className="sc-try">
              {view.tryPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="sc-prompt"
                  onClick={() => onTry?.(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          {onManage !== undefined && (
            <button type="button" className="sc-link" onClick={onManage}>
              Manage in Connections
            </button>
          )}
        </>
      )}

      {view.phase === 'failed' && (
        <>
          {view.steps !== undefined && <Steps steps={view.steps} />}
          <p className="sc-err" role="alert">
            {view.error}
          </p>
          <div className="sc-actions">
            <button type="button" className="sc-btn sc-btn--ghost" onClick={onNotNow}>
              Not now
            </button>
            <button type="button" className="sc-btn sc-btn--gold" onClick={onRetry}>
              Try again
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export const INSTALL_CARD_CSS = `
.sc {
  --sc-bg: ${t.color.sidebar}; --sc-line: ${t.color.fieldLine}; --sc-text: ${t.color.text};
  --sc-muted: ${t.color.textMuted}; --sc-soft: #C9CEE0; --sc-tile: #222845; --sc-ok: #8FD19E;
  --sc-okfill: rgba(143, 209, 158, 0.16); --sc-gold: ${t.color.gold}; --sc-goldink: ${t.color.goldInk};
  --sc-errfill: #3A1D2A; --sc-errink: #FFB4C0; --sc-link: ${t.color.sky};
  --sc-warnfill: rgba(242, 193, 78, 0.1); --sc-warnline: rgba(242, 193, 78, 0.35); --sc-warnink: #F2D27A;
  box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; padding: 14px;
  border: 1px solid var(--sc-line); border-radius: 12px; background: var(--sc-bg); color: var(--sc-text);
  font-family: ${t.font.ui}; ${typeCss('body')};
}
.sc--light {
  --sc-bg: ${t.color.controlFill}; --sc-line: ${t.color.panelLine}; --sc-text: ${t.color.panelText};
  --sc-muted: ${t.color.panelMuted}; --sc-soft: ${t.color.panelMuted}; --sc-tile: ${t.color.panelTile};
  --sc-ok: ${t.color.okInk}; --sc-okfill: ${t.color.okFill}; --sc-errfill: ${t.color.errFill};
  --sc-errink: ${t.color.errInk}; --sc-link: ${t.color.link}; --sc-warnfill: ${t.color.warnFill};
  --sc-warnline: #E6CF8A; --sc-warnink: ${t.color.warnInk};
}
.sc-top { display: flex; gap: 12px; align-items: flex-start; }
.sc-tile {
  flex: none; width: 36px; height: 36px; border-radius: 10px; background: var(--sc-tile);
  display: grid; place-items: center; font-weight: 600;
}
.sc-id { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sc-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-weight: 600; font-size: 14px; line-height: 21px; }
.sc-meta { color: var(--sc-muted); ${typeCss('small')}; }
.sc-what { margin: 0; ${typeCss('body')}; }
.sc-note { margin: 0; color: var(--sc-soft); ${typeCss('small')}; }
.sc-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--sc-ok); font-weight: 600; ${typeCss('small')}; }
.sc-chip {
  flex: none; display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px;
  ${typeCss('caption')}; background: var(--sc-tile); color: var(--sc-soft);
}
.sc-chip--ok { background: var(--sc-okfill); color: var(--sc-ok); }
.sc-chip--gold { background: rgba(242, 193, 78, 0.16); color: var(--sc-gold); }
.sc--light .sc-chip--gold { color: ${t.color.warnInk}; background: ${t.color.warnFill}; }
.sc-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; ${typeCss('body')}; }
.sc-steps li { display: flex; align-items: center; gap: 8px; color: var(--sc-muted); }
.sc-steps li.is-done, .sc-steps li.is-now { color: var(--sc-text); }
.sc-steps li.is-fail { color: var(--sc-errink); }
.st {
  flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--sc-line);
  display: grid; place-items: center; box-sizing: border-box;
}
.st--done { background: #8FD19E; border-color: #8FD19E; color: #12162B; }
.st--fail { background: #FFB4C0; border-color: #FFB4C0; color: #3A1D2A; }
.st--now { border-color: var(--sc-gold); }
.spin-n { width: 8px; height: 8px; border-radius: 50%; background: var(--sc-gold); }
.sc-prog { display: flex; flex-direction: column; gap: 6px; }
.sc-prog-top { display: flex; justify-content: space-between; ${typeCss('small')}; font-weight: 600; }
.sc-bar { height: 4px; border-radius: 2px; background: var(--sc-tile); overflow: hidden; }
.sc-bar i { display: block; height: 100%; background: var(--sc-gold); }
.sc-check {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 10px;
  background: var(--sc-warnfill); border: 1px solid var(--sc-warnline); color: var(--sc-warnink); ${typeCss('body')};
}
.sc-check-t { font-weight: 600; }
.sc-check ul { margin: 0; padding-left: 18px; }
.sc-link {
  align-self: flex-start; padding: 0; border: 0; background: transparent; color: var(--sc-link);
  font: inherit; ${typeCss('small')}; font-weight: 600; cursor: pointer; text-decoration: none;
}
.sc-disc { ${typeCss('body')}; color: var(--sc-soft); font-weight: 600; }
.sc-disc ul { margin: 6px 0 0; padding-left: 18px; font-weight: 400; overflow-wrap: anywhere; }
.sc-try { display: flex; gap: 6px; flex-wrap: wrap; }
.sc-prompt {
  display: inline-flex; align-items: center; min-height: 28px; padding: 4px 12px; box-sizing: border-box;
  border-radius: 999px; border: 1px solid var(--sc-line); background: transparent; color: var(--sc-text);
  font: inherit; ${typeCss('small')}; cursor: pointer;
}
.sc-err {
  display: flex; margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--sc-errfill);
  color: var(--sc-errink); ${typeCss('body')};
}
.sc-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.sc-btn {
  display: inline-flex; align-items: center; height: 32px; padding: 0 14px; border-radius: 8px;
  font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer;
}
.sc-btn--gold { border: 0; background: var(--sc-gold); color: var(--sc-goldink); }
.sc-btn--ghost { border: 1px solid var(--sc-line); background: transparent; color: var(--sc-text); }
.sc-btn:focus-visible, .sc-link:focus-visible, .sc-prompt:focus-visible, .sc-disc summary:focus-visible {
  outline: 2px solid var(--tg-focus, ${t.color.focusOnNavy}); outline-offset: 2px;
}
`;
