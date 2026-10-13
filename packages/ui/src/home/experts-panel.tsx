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
  canEdit: boolean;
  enabled: boolean;
  command: string;
}

const NEW_DRAFT: Draft = {
  name: 'Claude Code',
  goodAt: '',
  canEdit: false,
  enabled: true,
  command: '',
};

const draftOf = (expert: Expert): Draft => ({
  name: expert.name,
  goodAt: expert.goodAt,
  canEdit: expert.connection.canEdit,
  enabled: expert.enabled,
  command: expert.connection.command ?? '',
});

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

  const reload = useCallback(() => {
    void bridge.listExperts?.().then(setExperts);
  }, [bridge]);
  useEffect(reload, [reload]);

  if (bridge.listExperts === undefined) {
    return <p className="home-note">Experts are set up in the Tagalong desktop app.</p>;
  }
  if (experts === null) return <p className="home-note">Loading experts…</p>;

  if (open !== null) {
    const expert = experts.find((e) => e.id === open);
    return (
      <ExpertForm
        key={open}
        expert={expert}
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
        <button type="button" className="tg-btn" onClick={() => setOpen('new')}>
          Add expert
        </button>
      </div>
    </div>
  );
}

function ExpertForm({
  expert,
  taken,
  onDone,
  onSaved,
}: {
  expert: Expert | undefined;
  taken: readonly string[];
  onDone: () => void;
  onSaved: () => void;
}) {
  const bridge = useHostBridge();
  const [draft, setDraft] = useState<Draft>(expert ? draftOf(expert) : NEW_DRAFT);
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
      // An old expert's default folder is dropped: each task picks its project.
      connection: {
        type: 'claude-code',
        canEdit: draft.canEdit,
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
