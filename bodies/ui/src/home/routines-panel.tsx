/**
 * Home's Routines page: what Scout does on its own, when, and where the result goes. The
 * list, the templates and the form, which also edits a routine from Scout's card.
 * Contains RoutinesPanel.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import {
  RoutineDraft,
  describeWhen,
  type CalendarCheckResult,
  type Expert,
  type RoutineDraftInput,
  type RoutineProposedParams,
  type RoutineView,
  type RoutineWhen,
} from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';

/** The "When" choices, in plain words. Days of the week and a time; no cron. */
type WhenKind = 'daily' | 'weekdays' | 'days' | 'launch' | 'app' | 'expert' | 'watch' | 'meeting';

const WHEN_KINDS: readonly { id: WhenKind; label: string }[] = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'days', label: 'On chosen days' },
  { id: 'launch', label: 'When Tagalong opens' },
  { id: 'app', label: 'When an app or site appears' },
  { id: 'expert', label: 'When an expert finishes' },
  { id: 'watch', label: 'When a watch fires' },
  { id: 'meeting', label: 'Before each meeting' },
];

/** Meeting prep's lead times. A routine saved with another keeps its own. */
const LEADS = [10, 30];

/** Monday first, as a week reads; the numbers are `Date#getDay`'s. */
const DAYS: readonly { day: number; label: string }[] = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

interface Form {
  id?: string;
  name: string;
  kind: WhenKind;
  time: string;
  days: number[];
  match: string;
  minutesBefore: number;
  /** A new calendar link to keep. Never part of the routine: it goes to the keychain. */
  link: string;
  what: string;
  topics: string;
  showTopics: boolean;
  bubble: boolean;
  voice: boolean;
  notification: boolean;
  handTo: string;
  uses: string[];
  enabled: boolean;
}

const BLANK: Form = {
  name: '',
  kind: 'weekdays',
  time: '09:00',
  days: [],
  match: '',
  minutesBefore: 10,
  link: '',
  what: '',
  topics: '',
  showTopics: false,
  bubble: true,
  voice: false,
  notification: false,
  handTo: '',
  uses: [],
  enabled: true,
};

interface Template {
  id: string;
  name: string;
  line: string;
  form: (experts: readonly Expert[]) => Form;
}

/** The first Claude Code expert switched on: Morning papers' way onto the web. */
function researcher(experts: readonly Expert[]): Expert | undefined {
  return experts.find((e) => e.enabled && e.connection.type === 'claude-code');
}

const TEMPLATES: readonly Template[] = [
  {
    id: 'papers',
    name: 'Morning papers',
    line: 'New papers on your topics, each with why it matters.',
    form: (experts) => {
      const expert = researcher(experts);
      return {
        ...BLANK,
        name: 'Morning papers',
        kind: 'weekdays',
        time: '08:00',
        what:
          'Find papers from the last day on my topics. List each as its title and one line on ' +
          'why it matters, then offer to explain one simply. Use a paper app such as arXiv if ' +
          'one is connected; otherwise hand it to the expert below to search the web.',
        showTopics: true,
        handTo: expert?.id ?? '',
        uses: expert === undefined ? [] : [expert.name],
      };
    },
  },
  {
    id: 'calendar',
    name: 'Today’s calendar',
    line: 'What your day looks like, from your connected calendar.',
    form: () => ({
      ...BLANK,
      name: 'Today’s calendar',
      kind: 'weekdays',
      time: '08:30',
      what:
        'Read today’s events from my connected calendar and tell me what my day looks like in ' +
        'three lines, with anything I need to prepare.',
      uses: ['Calendar'],
    }),
  },
  {
    id: 'reviews',
    name: 'Reviews waiting on GitHub',
    line: 'Pull requests waiting on your review, oldest first.',
    form: () => ({
      ...BLANK,
      name: 'Reviews waiting on GitHub',
      kind: 'weekdays',
      time: '09:30',
      what:
        'Check GitHub for pull requests waiting on my review and list them oldest first, one ' +
        'line each, with how long each has waited.',
      uses: ['GitHub'],
    }),
  },
  {
    id: 'needs-me',
    name: 'What needs me',
    line: 'Reviews, issues and mentions waiting on you, across your connected apps.',
    form: () => ({
      ...BLANK,
      name: 'What needs me',
      kind: 'weekdays',
      time: '09:00',
      what:
        'List what is waiting on me across my connected apps: reviews requested, issues assigned ' +
        'to me, mentions. One line each, oldest first.',
      uses: ['GitHub', 'Linear', 'Notion'],
    }),
  },
  {
    id: 'summary',
    name: 'End-of-day summary',
    line: 'What you worked on today, and a first step for tomorrow.',
    form: () => ({
      ...BLANK,
      name: 'End-of-day summary',
      kind: 'weekdays',
      time: '17:30',
      what:
        'Look at the windows I have open and sum up what I worked on today in three lines, ' +
        'then suggest the first thing to pick up tomorrow.',
    }),
  },
  {
    id: 'meeting',
    name: 'Meeting prep',
    line: 'Before each meeting: the agenda, the last thread, docs and open questions.',
    form: () => ({
      ...BLANK,
      name: 'Meeting prep',
      kind: 'meeting',
      minutesBefore: 10,
      what:
        'Prepare me for this meeting. Start with one line: the meeting, when, and the gist. ' +
        'Then four short parts: the agenda, the last thread with these people, related docs, ' +
        'and open questions. Use what you remember and the read tools of my connected apps ' +
        '(Notion, GitHub, mail) for the last thread and the docs; if no app is connected, say ' +
        'so in one line.',
      uses: ['Calendar'],
    }),
  },
  { id: 'blank', name: 'Blank', line: 'Start from nothing.', form: () => ({ ...BLANK }) },
];

function formOf(routine: RoutineDraftInput & { id?: string }): Form {
  const draft = RoutineDraft.parse(routine);
  const when = draft.when;
  const kind: WhenKind =
    when.type === 'schedule'
      ? when.days.length === 7
        ? 'daily'
        : [...when.days].sort().join(',') === '1,2,3,4,5'
          ? 'weekdays'
          : 'days'
      : when.type;
  return {
    ...(routine.id !== undefined ? { id: routine.id } : {}),
    name: draft.name,
    kind,
    time: when.type === 'schedule' ? when.time : '09:00',
    days: when.type === 'schedule' ? [...when.days] : [],
    match: when.type === 'app' ? when.match : '',
    minutesBefore: when.type === 'meeting' ? when.minutesBefore : 10,
    link: '',
    what: draft.what,
    topics: draft.topics,
    showTopics: draft.topics.trim() !== '',
    ...draft.deliver,
    handTo: draft.handTo ?? '',
    uses: draft.uses,
    enabled: draft.enabled,
  };
}

function whenOf(form: Form): RoutineWhen | string {
  switch (form.kind) {
    case 'daily':
      return { type: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], time: form.time };
    case 'weekdays':
      return { type: 'schedule', days: [1, 2, 3, 4, 5], time: form.time };
    case 'days':
      if (form.days.length === 0) return 'Pick at least one day.';
      return { type: 'schedule', days: [...form.days].sort((a, b) => a - b), time: form.time };
    case 'app':
      if (form.match.trim() === '') return 'Say which app or site, such as Outlook.';
      return { type: 'app', match: form.match.trim() };
    case 'meeting':
      return { type: 'meeting', minutesBefore: form.minutesBefore };
    default:
      return { type: form.kind };
  }
}

/** The routine the form would save, or what is missing in words. */
function draftOf(form: Form): RoutineDraftInput | string {
  if (form.name.trim() === '') return 'Give the routine a name.';
  if (form.what.trim() === '') return 'Say what Scout should do each time.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.time)) return 'Pick a time, such as 08:00.';
  const when = whenOf(form);
  if (typeof when === 'string') return when;
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    when,
    what: form.what.trim(),
    topics: form.topics.trim(),
    deliver: { bubble: form.bubble, voice: form.voice, notification: form.notification },
    uses: form.uses,
    ...(form.handTo !== '' ? { handTo: form.handTo } : {}),
  };
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const LAST: Record<NonNullable<RoutineView['lastState']>, string> = {
  running: 'running now',
  done: 'done',
  error: 'failed',
};

type Open = { kind: 'list' } | { kind: 'templates' } | { kind: 'form'; form: Form };

/**
 * Home's Routines page: what Scout does on its own, when, and where the result goes. Each one
 * has its switch, its last run (with the way to Activity) and its next; New routine starts from
 * a template. Saving here is the person's consent, as Save on Scout's card is.
 */
export function RoutinesPanel({
  draft,
  onOpenActivity,
}: {
  /** Scout's card, opened here by its Edit button; saving goes back through the card. */
  draft?: RoutineProposedParams | undefined;
  onOpenActivity?: () => void;
}) {
  const bridge = useHostBridge();
  const [routines, setRoutines] = useState<RoutineView[] | null>(null);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [open, setOpen] = useState<Open>(
    draft === undefined ? { kind: 'list' } : { kind: 'form', form: formOf(draft.routine) },
  );
  const [lastDraft, setLastDraft] = useState(draft);
  if (draft !== lastDraft) {
    setLastDraft(draft);
    if (draft !== undefined) setOpen({ kind: 'form', form: formOf(draft.routine) });
  }

  const reload = useCallback(() => {
    void bridge.listRoutines?.().then(setRoutines);
  }, [bridge]);
  useEffect(reload, [reload]);
  useEffect(() => {
    void bridge.listExperts?.().then(setExperts);
  }, [bridge]);
  useEffect(
    () =>
      bridge.onTurnEvent((event) => {
        if (event.type === 'routines.changed') reload();
      }),
    [bridge, reload],
  );

  if (bridge.listRoutines === undefined) {
    return <p className="home-note">Routines are set up in the Tagalong desktop app.</p>;
  }
  if (routines === null) return <p className="home-note">Loading routines…</p>;

  if (open.kind === 'form') {
    return (
      <RoutineForm
        key={open.form.id ?? 'new'}
        initial={open.form}
        experts={experts}
        proposalId={
          draft !== undefined && open.form.id === undefined ? draft.proposalId : undefined
        }
        onDone={() => {
          setOpen({ kind: 'list' });
          reload();
        }}
      />
    );
  }

  if (open.kind === 'templates') {
    return (
      <section className="tg-panel home-controls" aria-label="New routine">
        <h3>New routine</h3>
        <p className="tg-note">Start from one of these, then change anything.</p>
        <div className="home-templates">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="home-template"
              onClick={() => setOpen({ kind: 'form', form: template.form(experts) })}
            >
              <span className="home-template__name">{template.name}</span>
              <span className="home-template__line">{template.line}</span>
            </button>
          ))}
        </div>
        <div className="tg-footer">
          <button type="button" className="tg-btn-quiet" onClick={() => setOpen({ kind: 'list' })}>
            Back to routines
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="tg-panel home-controls">
      <p className="tg-note">
        Things Scout does for you on its own: at a time you pick, or when something happens. Each
        run reads what it needs; anything that would change something still asks you first.
      </p>
      {routines.length === 0 ? (
        <p className="tg-note">
          No routines yet. Start one here, or ask Scout: “every weekday at 8, give me new papers on
          AI agents”.
        </p>
      ) : (
        <ul aria-label="Routines" className="home-conns__list">
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              onEdit={() => setOpen({ kind: 'form', form: formOf(routine) })}
              onChanged={reload}
              onOpenActivity={onOpenActivity}
            />
          ))}
        </ul>
      )}
      <div className="tg-footer">
        <button type="button" className="tg-btn" onClick={() => setOpen({ kind: 'templates' })}>
          New routine
        </button>
      </div>
    </div>
  );
}

function RoutineRow({
  routine,
  onEdit,
  onChanged,
  onOpenActivity,
}: {
  routine: RoutineView;
  onEdit: () => void;
  onChanged: () => void;
  onOpenActivity: (() => void) | undefined;
}) {
  const bridge = useHostBridge();
  const name = useId();
  const [ran, setRan] = useState(false);
  return (
    <li className="home-conn">
      <div className="home-conn__head">
        <span className="home-entry__body">
          <span id={name} className="home-entry__title">
            {routine.name}
          </span>
          <span className="home-entry__meta">{describeWhen(routine.when)}</span>
        </span>
        <button
          type="button"
          role="switch"
          className="tg-switch"
          aria-checked={routine.enabled}
          aria-labelledby={name}
          onClick={() =>
            void bridge.setRoutineEnabled?.(routine.id, !routine.enabled).then(onChanged)
          }
        >
          {routine.enabled ? 'On' : 'Off'}
        </button>
      </div>
      <p className="home-entry__meta home-routine__runs">
        <span>
          {routine.lastRunAt === undefined || routine.lastState === undefined
            ? 'Not run yet'
            : `Last run: ${LAST[routine.lastState]}, ${shortTime(routine.lastRunAt)}`}
        </span>
        {routine.lastActivityId !== undefined && onOpenActivity !== undefined && (
          <button type="button" className="home-link" onClick={onOpenActivity}>
            See in Activity
          </button>
        )}
        {routine.enabled && routine.nextRunAt !== undefined && (
          <span>Next: {shortTime(routine.nextRunAt)}</span>
        )}
      </p>
      {routine.problem !== undefined && <p className="tg-error">{routine.problem}</p>}
      <div className="home-conn__actions">
        <button
          type="button"
          className="tg-btn-quiet"
          disabled={ran}
          onClick={() => {
            setRan(true);
            void bridge.runRoutine?.(routine.id);
          }}
        >
          {ran ? 'Running…' : 'Run now'}
        </button>
        <button
          type="button"
          className="tg-btn-quiet"
          aria-label={`Edit ${routine.name}`}
          onClick={onEdit}
        >
          Edit
        </button>
      </div>
    </li>
  );
}

function RoutineForm({
  initial,
  experts,
  proposalId,
  onDone,
}: {
  initial: Form;
  experts: readonly Expert[];
  /** Set when this is Scout's card opened for editing: Save confirms the card. */
  proposalId: string | undefined;
  onDone: () => void;
}) {
  const bridge = useHostBridge();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [calendar, setCalendar] = useState<CalendarCheckResult | null>(null);
  const heading = useId();
  const meeting = form.kind === 'meeting';
  useEffect(() => {
    if (meeting) void bridge.checkCalendar?.().then(setCalendar);
  }, [bridge, meeting]);
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  const timed = form.kind === 'daily' || form.kind === 'weekdays' || form.kind === 'days';
  const switchedOn = experts.filter((e) => e.enabled);
  const label = form.name.trim() || 'this routine';

  const save = async (): Promise<void> => {
    const draft = draftOf(form);
    if (typeof draft === 'string') return setError(draft);
    const link = form.link.trim();
    if (meeting && link === '' && calendar?.linked !== true) {
      return setError('Paste your calendar link (.ics) first.');
    }
    setError(null);
    try {
      // The link goes to the keychain on its own; the routine never holds it.
      if (meeting && link !== '') await bridge.setCalendarLink?.(link);
      if (proposalId !== undefined) await bridge.confirmRoutine?.(proposalId, draft);
      else
        await bridge.saveRoutine?.({ ...draft, ...(form.id !== undefined ? { id: form.id } : {}) });
      onDone();
    } catch (failure) {
      setError(`Not saved. ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  };

  const remove = (): void => {
    if (form.id === undefined) return onDone();
    void bridge.deleteRoutine?.(form.id).then(onDone);
  };

  return (
    <section className="tg-panel home-controls home-routine" aria-labelledby={heading}>
      <h3 id={heading}>{initial.id !== undefined ? initial.name : 'New routine'}</h3>
      <label>
        <span>Name</span>
        <input value={form.name} onChange={(event) => set({ name: event.target.value })} />
      </label>
      <div className="home-routine__when">
        <label>
          <span>When</span>
          <select
            value={form.kind}
            onChange={(event) => set({ kind: event.target.value as WhenKind })}
          >
            {WHEN_KINDS.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
        {timed && (
          <label>
            <span>At</span>
            <input
              type="time"
              value={form.time}
              onChange={(event) => set({ time: event.target.value })}
            />
          </label>
        )}
        {meeting && (
          <label>
            <span>Minutes before</span>
            <select
              value={String(form.minutesBefore)}
              onChange={(event) => set({ minutesBefore: Number(event.target.value) })}
            >
              {[...new Set([...LEADS, form.minutesBefore])].map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </label>
        )}
        {form.kind === 'app' && (
          <label>
            <span>App or site</span>
            <input
              value={form.match}
              placeholder="Outlook"
              onChange={(event) => set({ match: event.target.value })}
            />
          </label>
        )}
      </div>
      {form.kind === 'days' && (
        <div className="home-days" role="group" aria-label="Days">
          {DAYS.map(({ day, label: dayLabel }) => (
            <button
              key={day}
              type="button"
              className="home-day"
              aria-pressed={form.days.includes(day)}
              onClick={() =>
                set({
                  days: form.days.includes(day)
                    ? form.days.filter((d) => d !== day)
                    : [...form.days, day],
                })
              }
            >
              {dayLabel}
            </button>
          ))}
        </div>
      )}
      {meeting && (
        <>
          <label>
            <span>Calendar link (.ics)</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={form.link}
              placeholder={calendar?.linked === true ? 'Kept in your keychain' : 'https://…'}
              onChange={(event) => set({ link: event.target.value })}
            />
          </label>
          <p className="tg-note">
            {calendar?.linked === true
              ? 'A link is kept in your keychain. Paste a new one only to change it. '
              : ''}
            Google: calendar settings, then Secret address in iCal format. Outlook: Calendar, Shared
            calendars, then Publish. The link is a key to your calendar: it stays in your keychain,
            never in settings or chat.
          </p>
          {calendar?.linked === true && (
            <button
              type="button"
              className="home-link home-routine__more"
              onClick={() => void bridge.setCalendarLink?.(null).then(setCalendar)}
            >
              Forget the link
            </button>
          )}
        </>
      )}
      {form.kind === 'app' && (
        <p className="tg-note">
          Runs when a window whose title or app name has this in it appears. Window titles only;
          blind spots never count.
        </p>
      )}
      <label>
        <span>What</span>
        <textarea
          rows={3}
          value={form.what}
          placeholder="Tell me what’s on my calendar today, in three lines."
          onChange={(event) => set({ what: event.target.value })}
        />
      </label>
      {form.showTopics ? (
        <label>
          <span>Topics</span>
          <input
            value={form.topics}
            placeholder="AI agents, robotics"
            onChange={(event) => set({ topics: event.target.value })}
          />
        </label>
      ) : (
        <button
          type="button"
          className="home-link home-routine__more"
          onClick={() => set({ showTopics: true })}
        >
          Add topics
        </button>
      )}
      <fieldset className="home-routine__deliver">
        <legend>Result goes to</legend>
        <label className="tg-check">
          <input
            type="checkbox"
            checked={form.bubble}
            onChange={(event) => set({ bubble: event.target.checked })}
          />
          <span>In Scout’s bubble</span>
        </label>
        <label className="tg-check">
          <input
            type="checkbox"
            checked={form.voice}
            onChange={(event) => set({ voice: event.target.checked })}
          />
          <span>Read aloud</span>
        </label>
        <label className="tg-check">
          <input
            type="checkbox"
            checked={form.notification}
            onChange={(event) => set({ notification: event.target.checked })}
          />
          <span>Windows notification</span>
        </label>
        <p className="tg-note">Activity always keeps a record of each run.</p>
      </fieldset>
      <label>
        <span>May hand to</span>
        <select value={form.handTo} onChange={(event) => set({ handTo: event.target.value })}>
          <option value="">No one without asking</option>
          {switchedOn.map((expert) => (
            <option key={expert.id} value={expert.id}>
              {expert.name}
            </option>
          ))}
        </select>
      </label>
      <p className="tg-note">
        {form.handTo === ''
          ? 'A hand-off from this routine shows the usual card and waits for Send.'
          : 'Each run may hand work to this expert without asking: read-only, with web search and no project, so it never touches your files.'}
      </p>
      {error !== null && (
        <p className="tg-error" role="alert">
          {error}
        </p>
      )}
      <div className="tg-footer home-controls__footer">
        <button type="button" className="tg-btn" onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="tg-btn-quiet" onClick={onDone}>
          Back to routines
        </button>
        {initial.id !== undefined &&
          (confirming ? (
            <span className="home-danger">
              <button type="button" className="tg-btn-quiet" onClick={remove}>
                Delete {label} for good
              </button>
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(false)}>
                Keep {label}
              </button>
            </span>
          ) : (
            <span className="home-danger">
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(true)}>
                Delete {label}
              </button>
            </span>
          ))}
      </div>
    </section>
  );
}
