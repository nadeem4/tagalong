import { useCallback, useEffect, useId, useState } from 'react';
import type { Expert } from '@tagalong/protocol';
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
}

const NEW_DRAFT: Draft = {
  name: 'Claude Code',
  goodAt: '',
  instructions: '',
  canEdit: false,
  canSearchWeb: false,
  enabled: true,
  command: '',
};

const draftOf = (expert: Expert): Draft => ({
  name: expert.name,
  goodAt: expert.goodAt,
  instructions: expert.instructions,
  canEdit: expert.connection.canEdit,
  canSearchWeb: expert.connection.canSearchWeb,
  enabled: expert.enabled,
  command: expert.connection.command ?? '',
});

interface Template {
  id: string;
  name: string;
  line: string;
  draft: Draft;
}

/**
 * Add expert starts from one of these. Each is only a filled-in form: the person sees the
 * standing instructions in full and can change any of it before saving.
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
    id: 'researcher',
    name: 'Researcher',
    line: 'Looks things up on the web and sums up, with sources. Never edits.',
    draft: {
      ...NEW_DRAFT,
      name: 'Researcher',
      goodAt: 'Looking things up on the web and summarising with sources',
      canSearchWeb: true,
      instructions:
        'You look things up on the web. Prefer primary and recent sources. Sum up what you ' +
        'found in plain words, say where sources disagree, and link every source you used. ' +
        'Do not change files.',
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
 * Home's Experts tab: the tools the companion hands work to. Claude Code is the only kind so
 * far. Saving also tests the connection, which costs nothing (`claude --version`), so the user
 * learns straight away whether the command is right.
 */
export function ExpertsPanel() {
  const bridge = useHostBridge();
  const [experts, setExperts] = useState<Expert[] | null>(null);
  // null: the list; 'new': the add form; an id: that expert's form.
  const [open, setOpen] = useState<string | null>(null);
  // Add expert shows the templates first; the one picked fills the add form.
  const [picking, setPicking] = useState(false);
  const [start, setStart] = useState<Draft>(NEW_DRAFT);

  const reload = useCallback(() => {
    void bridge.listExperts?.().then(setExperts);
  }, [bridge]);
  useEffect(reload, [reload]);

  if (bridge.listExperts === undefined) {
    return <p className="home-note">Experts are set up in the Tagalong desktop app.</p>;
  }
  if (experts === null) return <p className="home-note">Loading experts…</p>;

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
                  <span className="home-entry__preview">Asks which project for each task</span>
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
      // An old expert's default folder is dropped: each task picks its project.
      connection: {
        type: 'claude-code',
        canEdit: draft.canEdit,
        canSearchWeb: draft.canSearchWeb,
        ...(draft.command.trim() ? { command: draft.command.trim() } : {}),
      },
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
      <p className="tg-note">
        Each task asks which project to work in, guessed from your screen. When your companion
        can&apos;t tell, you pick it on the hand-off card.
      </p>
      <Switch
        label="Let it edit files by default"
        help="Off, it only reads and searches. You can still allow edits for one task when you send it."
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
