/**
 * Home's Experts page: the Claude Code experts Scout hands work to, the add form with its
 * templates, and the expert catalog with its install confirm. Contains ExpertsPanel and
 * expertIdFor.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import type { CatalogEntry, CatalogStatus, Expert } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';

/** A kebab-case id from the expert's name, unique among the ids already taken. */
export function expertIdFor(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'expert';
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}

interface Draft {
  name: string;
  goodAt: string;
  instructions: string;
  canEdit: boolean;
  canSearchWeb: boolean;
  enabled: boolean;
  command: string;
  /** Set only for an expert installed from the catalog, with its entry's bundle. */
  catalogId?: string;
  plugins: string[];
  mcpTools: string[];
  workspace: 'project' | 'own';
}

const NEW_DRAFT: Draft = {
  name: 'Claude Code',
  goodAt: '',
  instructions: '',
  canEdit: false,
  canSearchWeb: false,
  enabled: true,
  command: '',
  plugins: [],
  mcpTools: [],
  workspace: 'project',
};

/** The add form for a catalog entry: the same form as a template, with the entry's bundle. */
const draftOfEntry = (entry: CatalogEntry): Draft => ({
  ...NEW_DRAFT,
  name: entry.name,
  goodAt: entry.goodAt,
  instructions: entry.instructions,
  canEdit: entry.canEdit,
  canSearchWeb: entry.canSearchWeb,
  catalogId: entry.id,
  plugins: entry.plugins.map((plugin) => plugin.id),
  mcpTools: entry.apps.flatMap((app) => app.tools),
  workspace: entry.workspace,
});

const draftOf = (expert: Expert): Draft => ({
  name: expert.name,
  goodAt: expert.goodAt,
  instructions: expert.instructions,
  canEdit: expert.connection.canEdit,
  canSearchWeb: expert.connection.canSearchWeb,
  enabled: expert.enabled,
  command: expert.connection.command ?? '',
  ...(expert.catalogId === undefined ? {} : { catalogId: expert.catalogId }),
  plugins: expert.connection.plugins,
  mcpTools: expert.connection.mcpTools,
  workspace: expert.connection.workspace,
});

interface Template {
  id: string;
  name: string;
  line: string;
  draft: Draft;
}

/**
 * Add expert starts from one of these. Each is only a filled-in form: the person sees the
 * standing instructions in full and can change any of it before saving. The Researcher
 * comes from the catalog instead, with its plugins and apps.
 */
const TEMPLATES: readonly Template[] = [
  {
    id: 'coder',
    name: 'Coder',
    line: 'Writes and changes code, and adds tests. May edit files.',
    draft: {
      ...NEW_DRAFT,
      name: 'Coder',
      goodAt: 'Writing and changing code, adding tests',
      canEdit: true,
      instructions:
        'You write and change code in this project. Follow the style and patterns already ' +
        'there. Keep each change as small as the task allows, and add or update tests for ' +
        'what you change. When you finish, say what you changed and why, in a few lines.',
    },
  },
  {
    id: 'debugger',
    name: 'Debugger',
    line: 'Finds why something breaks from logs and stack traces. Reads only.',
    draft: {
      ...NEW_DRAFT,
      name: 'Debugger',
      goodAt: 'Finding why something breaks, reading logs and stack traces',
      instructions:
        'You find why something breaks. Read the error, the logs and the code it points to, ' +
        'and find the cause before suggesting anything. Do not change files. Answer with the ' +
        'cause, the evidence for it (file and line), and the smallest fix you would make.',
    },
  },
  {
    id: 'designer',
    name: 'Designer',
    line: 'Reviews UI, CSS, layout and accessibility in the project. Reads only.',
    draft: {
      ...NEW_DRAFT,
      name: 'Designer',
      goodAt: 'UI, CSS, layout and accessibility review in the project',
      instructions:
        'You review the user interface in this project: layout, spacing, type, colour, CSS ' +
        'and accessibility (contrast, labels, keyboard use). Do not change files. List what ' +
        'to change, most important first, each with the file and a short reason.',
    },
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    line: 'Checks a change for bugs, missing tests and unclear code. Reads only.',
    draft: {
      ...NEW_DRAFT,
      name: 'Reviewer',
      goodAt: 'Checking a change for bugs, missing tests and unclear code',
      instructions:
        'You review a change someone else just made. Read the files the brief names and what ' +
        'it says was done, then check the change: bugs, edge cases, missing or weak tests, and ' +
        'code that is hard to follow. Do not change files. Answer with what is wrong, most ' +
        'important first, each with the file and line, or say plainly that it looks right.',
    },
  },
  {
    id: 'blank',
    name: 'Blank',
    line: 'Claude Code with nothing filled in.',
    draft: NEW_DRAFT,
  },
];

type Status = { text: string; error: boolean } | null;

/**
 * Home's Experts page: the tools the companion hands work to. Every expert is a Claude Code
 * connection. Saving also tests the connection, which costs nothing (`claude --version`), so
 * the user learns straight away whether the command is right.
 */
export function ExpertsPanel() {
  const bridge = useHostBridge();
  const [experts, setExperts] = useState<Expert[] | null>(null);
  // null: the list; 'new': the add form; an id: that expert's form.
  const [open, setOpen] = useState<string | null>(null);
  // Add expert shows the templates first; the one picked fills the add form.
  const [picking, setPicking] = useState(false);
  const [start, setStart] = useState<Draft>(NEW_DRAFT);
  const [catalog, setCatalog] = useState<CatalogStatus[]>([]);
  // The catalog entry whose Install was pressed: its confirm card shows before anything runs.
  const [installing, setInstalling] = useState<CatalogStatus | null>(null);

  const reload = useCallback(() => {
    void bridge.listExperts?.().then(setExperts);
  }, [bridge]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (picking) void bridge.expertCatalog?.().then(setCatalog);
  }, [bridge, picking]);

  if (bridge.listExperts === undefined) {
    return <p className="home-note">Experts are set up in the Tagalong desktop app.</p>;
  }
  if (experts === null) return <p className="home-note">Loading experts…</p>;

  if (installing !== null) {
    return (
      <InstallCard
        status={installing}
        onBack={() => setInstalling(null)}
        onInstalled={() => {
          setStart(draftOfEntry(installing.entry));
          setInstalling(null);
          setPicking(false);
          setOpen('new');
        }}
      />
    );
  }

  if (picking) {
    return (
      <section className="tg-panel home-controls" aria-label="Add expert">
        <h3>Add expert</h3>
        <p className="tg-note">Start from one of these, then change anything.</p>
        <div className="home-templates">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="home-template"
              onClick={() => {
                setStart(template.draft);
                setPicking(false);
                setOpen('new');
              }}
            >
              <span className="home-template__name">{template.name}</span>
              <span className="home-template__line">{template.line}</span>
            </button>
          ))}
        </div>
        {catalog.length > 0 && (
          <>
            <h3>From the catalog</h3>
            <p className="tg-note">
              Ready-made experts that use the plugins and apps you already have in Claude Code.
              Tagalong keeps no sign-in for them.
            </p>
            {catalog.map((status) => (
              <CatalogCard
                key={status.entry.id}
                status={status}
                onInstall={() => setInstalling(status)}
              />
            ))}
          </>
        )}
        <div className="tg-footer">
          <button type="button" className="tg-btn-quiet" onClick={() => setPicking(false)}>
            Back to experts
          </button>
        </div>
      </section>
    );
  }

  if (open !== null) {
    const expert = experts.find((e) => e.id === open);
    return (
      <ExpertForm
        key={open}
        expert={expert}
        start={start}
        taken={experts.map((e) => e.id)}
        onDone={() => {
          setOpen(null);
          reload();
        }}
        onSaved={reload}
      />
    );
  }

  return (
    <div className="tg-panel home-controls">
      <p className="tg-note">
        Experts do the work your companion hands them. Add the tools you already use, and the
        companion briefs the right one instead of you copying and pasting.
      </p>
      {experts.length === 0 ? (
        <p className="tg-note">No experts yet. Add Claude Code to get started.</p>
      ) : (
        <ul aria-label="Experts" className="home-list">
          {experts.map((expert) => (
            <li key={expert.id}>
              <button type="button" className="home-entry" onClick={() => setOpen(expert.id)}>
                <span className="home-entry__body">
                  <span className="home-entry__title">{expert.name}</span>
                  <span className="home-entry__preview">
                    {expert.connection.workspace === 'own'
                      ? 'Works in its own folder'
                      : 'Asks which project for each task'}
                  </span>
                </span>
                <span className="tg-chip">
                  {expert.connection.canEdit ? 'Can edit' : 'Reads only'}
                </span>
                <span className={expert.enabled ? 'tg-chip tg-chip--ok' : 'tg-chip'}>
                  {expert.enabled ? 'On' : 'Off'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="tg-footer home-controls__footer">
        <button type="button" className="tg-btn" onClick={() => setPicking(true)}>
          Add expert
        </button>
      </div>
    </div>
  );
}

function ExpertForm({
  expert,
  start,
  taken,
  onDone,
  onSaved,
}: {
  expert: Expert | undefined;
  /** Where the add form starts: the template picked. */
  start: Draft;
  taken: readonly string[];
  onDone: () => void;
  onSaved: () => void;
}) {
  const bridge = useHostBridge();
  const [draft, setDraft] = useState<Draft>(expert ? draftOf(expert) : start);
  const [id, setId] = useState(expert?.id);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const heading = useId();
  const name = draft.name.trim() || 'this expert';
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = async (): Promise<void> => {
    if (draft.name.trim() === '')
      return setStatus({ text: 'Give the expert a name.', error: true });
    const next: Expert = {
      id: id ?? expertIdFor(draft.name, taken),
      name: draft.name.trim(),
      goodAt: draft.goodAt.trim(),
      enabled: draft.enabled,
      instructions: draft.instructions.trim(),
      // A default folder in a saved expert is not written back: each task picks its project.
      connection: {
        type: 'claude-code',
        canEdit: draft.canEdit,
        canSearchWeb: draft.canSearchWeb,
        ...(draft.command.trim() ? { command: draft.command.trim() } : {}),
        // The bundle is the catalog's; the engine checks it against the entry on save.
        plugins: draft.plugins,
        mcpTools: draft.mcpTools,
        workspace: draft.workspace,
      },
      ...(draft.catalogId === undefined ? {} : { catalogId: draft.catalogId }),
    };
    setBusy(true);
    setStatus(null);
    try {
      const saved = await bridge.saveExpert?.(next);
      if (saved === undefined) return;
      setId(saved.id);
      onSaved();
      const check = await bridge.testExpert?.(saved.id);
      setStatus(
        check === undefined || check.ok
          ? { text: `Saved. ${saved.name} is ready.`, error: false }
          : {
              text: `Saved, but ${saved.name} cannot be reached: ${check.error ?? 'no reason given.'}`,
              error: true,
            },
      );
    } catch (error) {
      setStatus({
        text: `Not saved. ${error instanceof Error ? error.message : String(error)}`,
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = (): void => {
    if (id === undefined) return onDone();
    void bridge.deleteExpert?.(id).then(onDone);
  };

  return (
    <section className="tg-panel home-controls" aria-labelledby={heading}>
      <h3 id={heading}>{expert ? expert.name : 'Add expert'}</h3>
      <label>
        <span>Name</span>
        <input value={draft.name} onChange={(event) => set({ name: event.target.value })} />
      </label>
      <label>
        <span>Good at</span>
        <textarea
          rows={2}
          value={draft.goodAt}
          placeholder="Code changes, debugging and tests in this folder"
          onChange={(event) => set({ goodAt: event.target.value })}
        />
      </label>
      <p className="tg-note">
        Your companion reads this when it picks who gets a task. Kind: Claude Code, on this
        computer. More kinds (Gemini, OpenAI and tool servers) arrive later.
      </p>
      <label>
        <span>Standing instructions</span>
        <textarea
          rows={5}
          maxLength={4000}
          value={draft.instructions}
          placeholder="What this expert should always do, such as: find the cause before suggesting a fix"
          onChange={(event) => set({ instructions: event.target.value })}
        />
      </label>
      <p className="tg-note">
        Sent with every task, on top of Claude Code&apos;s own instructions.
      </p>
      {draft.workspace === 'own' ? (
        <p className="tg-note">
          Works in its own folder, one of Tagalong&apos;s, never in your projects. Edits there are
          drafts for you to use.
        </p>
      ) : (
        <p className="tg-note">
          Each task asks which project to work in, guessed from your screen. When your companion
          can&apos;t tell, you pick it on the hand-off card.
        </p>
      )}
      <Switch
        label="Let it edit files by default"
        help={
          draft.workspace === 'own'
            ? 'Off, it only reads and searches. On, it writes drafts in its own folder.'
            : 'Off, it only reads and searches. You can still allow edits for one task when you send it.'
        }
        checked={draft.canEdit}
        onChange={(canEdit) => set({ canEdit })}
      />
      <Switch
        label="Let it search the web"
        help="Off, it works only with the project's files. On, it may also search and read web pages."
        checked={draft.canSearchWeb}
        onChange={(canSearchWeb) => set({ canSearchWeb })}
      />
      <Switch
        label="On"
        help={`Your companion can hand work to ${name}.`}
        checked={draft.enabled}
        onChange={(enabled) => set({ enabled })}
      />
      <details>
        <summary className="tg-note">Advanced</summary>
        <label>
          <span>Command (leave empty to use claude on your PATH)</span>
          <input
            value={draft.command}
            placeholder="claude"
            onChange={(event) => set({ command: event.target.value })}
          />
        </label>
      </details>
      <div className="tg-footer home-controls__footer">
        <button type="button" className="tg-btn" disabled={busy} onClick={() => void save()}>
          {busy ? 'Testing…' : 'Save and test'}
        </button>
        <button type="button" className="tg-btn-quiet" onClick={onDone}>
          Back to experts
        </button>
        {expert !== undefined &&
          (confirming ? (
            <span className="home-danger">
              <button type="button" className="tg-btn-quiet" onClick={remove}>
                Delete {expert.name} for good
              </button>
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(false)}>
                Keep {expert.name}
              </button>
            </span>
          ) : (
            <span className="home-danger">
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(true)}>
                Delete {expert.name}
              </button>
            </span>
          ))}
        {status !== null && (
          <p
            className={status.error ? 'tg-error' : undefined}
            role={status.error ? 'alert' : 'status'}
          >
            {status.text}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * One catalog entry on the Add expert screen: what it is good at, the plugins it uses
 * (installed or missing), the apps it may use (set up in Claude Code or not), what it may
 * do in plain words, and the exact app tools it is allowed.
 */
function CatalogCard({ status, onInstall }: { status: CatalogStatus; onInstall: () => void }) {
  const { entry } = status;
  const tools = entry.apps.flatMap((app) => app.tools);
  return (
    <section className="home-catalog" aria-label={entry.name}>
      <span className="home-template__name">{entry.name}</span>
      <span className="home-template__line">{entry.line}</span>
      {status.plugins.length > 0 && (
        <>
          <span className="home-catalog__label">Uses</span>
          <ul aria-label="Uses" className="home-catalog__list">
            {status.plugins.map((plugin) => (
              <li key={plugin.id}>
                <span>{plugin.name}</span>
                <span className={plugin.installed ? 'tg-chip tg-chip--ok' : 'tg-chip'}>
                  {plugin.installed ? 'Installed' : 'Missing'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {status.apps.length > 0 && (
        <>
          <span className="home-catalog__label">Apps</span>
          <ul aria-label="Apps" className="home-catalog__list">
            {status.apps.map((app) => (
              <li key={app.name}>
                {app.name}:{' '}
                {app.found
                  ? 'found in Claude Code'
                  : app.optional
                    ? 'not set up (optional)'
                    : 'not set up'}
              </li>
            ))}
          </ul>
        </>
      )}
      <span className="home-catalog__label">May do</span>
      <p className="tg-note">{entry.mayDo}</p>
      {tools.length > 0 && <AllowedTools tools={tools} />}
      <div className="tg-footer">
        <button
          type="button"
          className="tg-btn"
          aria-label={`Install ${entry.name}`}
          onClick={onInstall}
        >
          Install
        </button>
      </div>
    </section>
  );
}

/** The exact app tools a catalog expert may call. Every other tool is refused. */
function AllowedTools({ tools }: { tools: readonly string[] }) {
  return (
    <>
      <span className="home-catalog__label">Allowed app tools (every other tool is refused)</span>
      <ul aria-label="Allowed app tools" className="home-catalog__tools">
        {tools.map((tool) => (
          <li key={tool}>
            <code>{tool}</code>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The last look before Install runs anything: each plugin Claude Code will install, by its
 * id, and the app tools the expert will be allowed. Nothing runs until the person presses.
 */
function InstallCard({
  status,
  onBack,
  onInstalled,
}: {
  status: CatalogStatus;
  onBack: () => void;
  onInstalled: () => void;
}) {
  const bridge = useHostBridge();
  const heading = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { entry } = status;
  const missing = status.plugins.filter((plugin) => !plugin.installed);
  const tools = entry.apps.flatMap((app) => app.tools);

  const install = async (): Promise<void> => {
    if (missing.length === 0) return onInstalled();
    setBusy(true);
    setProblem(null);
    try {
      const result = await bridge.installExpert?.(entry.id);
      if (result === undefined || result.ok) return onInstalled();
      setProblem(result.error ?? 'The install did not finish.');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tg-panel home-controls" aria-labelledby={heading}>
      <h3 id={heading}>Install {entry.name}?</h3>
      {missing.length > 0 ? (
        <>
          <p className="tg-note">
            Tagalong runs Claude Code&apos;s own <code>claude plugin install</code> for:
          </p>
          <ul className="home-catalog__list">
            {missing.map((plugin) => (
              <li key={plugin.id}>
                {plugin.name} <code>{plugin.id}</code>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="tg-note">Nothing to install: Claude Code has every plugin it uses.</p>
      )}
      {tools.length > 0 && <AllowedTools tools={tools} />}
      <p className="tg-note">{entry.mayDo}</p>
      <div className="tg-footer home-controls__footer">
        <button type="button" className="tg-btn" disabled={busy} onClick={() => void install()}>
          {busy ? 'Installing…' : missing.length > 0 ? 'Install and continue' : 'Continue'}
        </button>
        <button type="button" className="tg-btn-quiet" onClick={onBack}>
          Not now
        </button>
        {problem !== null && (
          <p className="tg-error" role="alert">
            {problem}
          </p>
        )}
      </div>
    </section>
  );
}

/** An on/off switch with its label and one line of help; the state reads as text too. */
function Switch({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="home-switch">
      <span>
        <span id={id} className="home-switch__label">
          {label}
        </span>
        <span className="tg-note">{help}</span>
      </span>
      <button
        type="button"
        role="switch"
        className="tg-switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
      >
        {checked ? 'On' : 'Off'}
      </button>
    </div>
  );
}
