/**
 * The task board: one pure read model over Scout's jobs, experts working and waiting for
 * Send, watches, routines, and the last 24 h of finished expert and routine runs. Short ids
 * (`j-7f3a`, `h-`, `w-`, `r-`) name items to the mind.
 */
import type { ActivityEntry } from '@tagalong/protocol';
import { hideSecrets } from '../privacy/secrets';
import { clip, type Capacity } from './jobs';
import type { JobRow } from './store';

const DAY_MS = 24 * 60 * 60_000;
const TITLE_CHARS = 100;
const NOTE_CHARS = 200;

export interface BoardSources {
  jobs: readonly JobRow[];
  experts: readonly { handoffId: string; expertName: string; ask: string }[];
  pending: readonly { expertName: string; ask: string }[];
  watches: readonly { watchId: string; condition: string; checks: number; maxChecks: number }[];
  routines: readonly { routineId: string; name: string }[];
  /** Activity rows of the last day; finished expert and routine runs are kept. */
  finished: readonly ActivityEntry[];
}

export interface BoardItem {
  /** The short id; none for what cannot be named (a brief waiting for Send, a running routine). */
  id?: string;
  /** The full id behind it. */
  ref: string;
  kind: 'job' | 'expert' | 'watch' | 'routine';
  state: 'queued' | 'running' | 'waiting' | 'done' | 'error' | 'stopped';
  title: string;
  startedAt?: string;
  finishedAt?: string;
  note?: string;
  error?: string;
  /** A watch: "12 of 60 checks". */
  progress?: string;
}

/** Live work first, then briefs waiting for Send, then the last day's finished work, newest first. */
export function boardItems(src: BoardSources, now: Date): BoardItem[] {
  const since = now.getTime() - DAY_MS;
  const live: BoardItem[] = [];
  const finished: BoardItem[] = [];
  const ended = (item: BoardItem, at: string | null | undefined, note: string, error?: string) => {
    if (at == null || Date.parse(at) < since) return;
    finished.push({
      ...item,
      finishedAt: at,
      ...(note.trim() === '' ? {} : { note: clip(oneLine(note), NOTE_CHARS) }),
      ...(error ? { error: clip(oneLine(error), NOTE_CHARS) } : {}),
    });
  };

  for (const job of src.jobs) {
    const item: BoardItem = {
      id: shortId('j', job.id),
      ref: job.id,
      kind: 'job',
      state: job.state,
      title: title(job.task),
      ...(job.startedAt === null ? {} : { startedAt: job.startedAt }),
    };
    if (job.state === 'queued' || job.state === 'running') live.push(item);
    else ended(item, job.finishedAt, job.note ?? '', job.error ?? undefined);
  }
  live.sort((a, b) => (a.state === b.state ? 0 : a.state === 'running' ? -1 : 1));
  for (const { handoffId, expertName, ask } of src.experts) {
    const id = shortId('h', handoffId);
    live.push({
      id,
      ref: handoffId,
      kind: 'expert',
      state: 'running',
      title: title(`${expertName}: ${para(ask)}`),
    });
  }
  for (const watch of src.watches) {
    live.push({
      id: shortId('w', watch.watchId),
      ref: watch.watchId,
      kind: 'watch',
      state: 'running',
      title: title(watch.condition),
      progress: `${watch.checks} of ${watch.maxChecks} checks`,
    });
  }
  for (const routine of src.routines) {
    live.push({
      ref: routine.routineId,
      kind: 'routine',
      state: 'running',
      title: title(`Routine ${routine.name}`),
    });
  }
  const waiting: BoardItem[] = src.pending.map((brief) => ({
    ref: '',
    kind: 'expert',
    state: 'waiting',
    title: title(`${brief.expertName}: ${para(brief.ask)}`),
  }));

  for (const row of src.finished) {
    if ((row.kind !== 'expert' && row.kind !== 'routine') || row.state === 'running') continue;
    const expert = row.kind === 'expert';
    const item: BoardItem = {
      id: shortId(expert ? 'h' : 'r', row.id),
      ref: row.id,
      kind: row.kind,
      state: row.state,
      title: title(
        expert
          ? `${row.expertName ?? 'An expert'}: ${para(row.text ?? '')}`
          : `Routine ${row.text ?? ''}`,
      ),
    };
    ended(item, row.finishedAt, para(row.answer ?? '').split('\n')[0]!, row.error);
  }
  finished.sort((a, b) => Date.parse(b.finishedAt!) - Date.parse(a.finishedAt!));
  return [...live, ...waiting, ...finished];
}

/** The `board` tool's text: facts only, sections only when they have items. */
export function renderBoard(
  items: readonly BoardItem[],
  now: Date,
  options: { timeZone?: string; capacity?: Capacity } = {},
): string {
  if (items.length === 0) return 'Nothing is running and nothing finished today.';
  const live = items.filter((item) => item.state === 'running' || item.state === 'queued');
  const waiting = items.filter((item) => item.state === 'waiting');
  const finished = items.filter((item) => item.finishedAt !== undefined);
  const lines: string[] = [];
  if (live.length > 0) {
    lines.push('Working now:', ...live.map((item) => `- ${liveLine(item, now)}`));
    const jobs = live.filter((item) => item.kind === 'job');
    const queued = jobs.filter((item) => item.state === 'queued').length;
    const busy = options.capacity?.busy !== undefined;
    if (jobs.length > 0 && (queued > 0 || busy)) {
      const why = busy ? busyLine(options.capacity!) : 'At most 3 run at a time.';
      lines.push(`Your jobs: ${jobs.length - queued} running, ${queued} waiting. ${why}`);
    }
  }
  if (waiting.length > 0)
    lines.push('Waiting for their Send:', ...waiting.map((item) => `- ${item.title}`));
  if (finished.length > 0) {
    lines.push(
      'Finished today:',
      ...finished.map((item) => `- ${finishedLine(item, options.timeZone)}`),
    );
  }
  return lines.join('\n');
}

/**
 * The item an id names: its short id, its full id, or the start of the full id after the
 * prefix. Two or more matches come back as ambiguous; none as null.
 */
export function resolveId(
  items: readonly BoardItem[],
  id: string,
): BoardItem | { ambiguous: BoardItem[] } | null {
  const wanted = id.trim().toLowerCase();
  const named = items.filter((item) => item.id !== undefined);
  const prefix = /^([jhwr])-/.exec(wanted)?.[1];
  const hex = wanted.replace(/^[jhwr]-/, '').replace(/-/g, '');
  const exact = named.filter((item) => item.id === wanted || item.ref === wanted);
  const matches =
    exact.length > 0 || hex === ''
      ? exact
      : named.filter(
          (item) =>
            (prefix === undefined || item.id!.startsWith(`${prefix}-`)) &&
            item.ref.replace(/-/g, '').startsWith(hex),
        );
  if (matches.length === 0) return null;
  return matches.length === 1 ? matches[0]! : { ambiguous: matches };
}

/** A longer id for an ambiguous match: the prefix and eight hex. */
export function longId(item: BoardItem): string {
  return `${item.id!.slice(0, 2)}${item.ref.replace(/-/g, '').slice(0, 8)}`;
}

/** Why fewer jobs run than the most: the body's reading of the machine, as a fact. */
export function busyLine(capacity: Capacity): string {
  const why =
    capacity.busy === 'memory'
      ? 'The machine is short of free memory'
      : "The machine's CPU is busy";
  return `${why}, so ${capacity.slots} ${capacity.slots === 1 ? 'runs' : 'run'} at a time now.`;
}

/** `j-7f3a`: the prefix and the first four hex of the id. */
export function shortId(prefix: 'j' | 'h' | 'w' | 'r', id: string): string {
  return `${prefix}-${id.replace(/-/g, '').slice(0, 4).toLowerCase()}`;
}

/** " (4 min)" since `iso`; nothing for a time that is missing or does not parse. */
export function minutes(iso: string | null | undefined, now: Date): string {
  const then = iso == null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(then)
    ? ''
    : ` (${Math.max(0, Math.floor((now.getTime() - then) / 60_000))} min)`;
}

/** "09:40" in the person's time zone. */
export function clock(iso: string, timeZone: string | undefined): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone === undefined ? {} : { timeZone }),
  });
}

function liveLine(item: BoardItem, now: Date): string {
  switch (item.kind) {
    case 'job':
      return item.state === 'queued'
        ? `${item.id} your job, waiting to start: ${item.title}`
        : `${item.id} your job, running${minutes(item.startedAt, now)}: ${item.title}`;
    case 'expert':
      return `${item.id} ${item.title}, running`;
    case 'watch':
      return `${item.id} watching for "${item.title}" (${item.progress})`;
    case 'routine':
      return `${item.title}, running`;
  }
}

function finishedLine(item: BoardItem, timeZone: string | undefined): string {
  const when = `${item.state === 'error' ? 'failed' : item.state} ${clock(item.finishedAt!, timeZone)}`;
  const head =
    item.kind === 'job'
      ? `${item.id} your job, ${when}: ${item.title}`
      : `${item.id} ${item.title}, ${when}`;
  return `${head}${item.note ? `. Note: ${item.note}` : ''}${item.error ? `. Error: ${item.error}` : ''}`;
}

function para(text: string): string {
  return (text.split(/\n\s*\n/)[0] ?? '').trim();
}

function title(text: string): string {
  return clip(oneLine(hideSecrets(text)), TITLE_CHARS);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
