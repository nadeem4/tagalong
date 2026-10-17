/**
 * The task board: one read model over everything in flight and finished today. Scout's own
 * jobs, experts working and waiting for Send, watches, routines, and the last 24 h of
 * finished expert and routine runs. Contains `boardItems`, `renderBoard` (the `board` tool's
 * facts) and `resolveId` (short ids such as `j-7f3a`). Pure: the engine passes the sources.
 */
import type { ActivityEntry } from '@tagalong/protocol';
import { hideSecrets } from '../privacy/secrets';
import type { Capacity } from './jobs';
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
  /** The short id the mind uses (`j-`, `h-`, `w-`, `r-`); none for what cannot be named. */
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
  /** A job a check-in line already mentioned. */
  told?: boolean;
  /** A watch: "12 of 60 checks". */
  progress?: string;
}

/** Live work first, then briefs waiting for Send, then the last day's finished work, newest first. */
export function boardItems(src: BoardSources, now: Date): BoardItem[] {
  const since = now.getTime() - DAY_MS;
  const recent = (at: string | null | undefined) => at != null && Date.parse(at) >= since;
  const live: BoardItem[] = [];
  const finished: BoardItem[] = [];

  for (const job of src.jobs) {
    const item: BoardItem = {
      id: shortId('j', job.id),
      ref: job.id,
      kind: 'job',
      state: job.state,
      title: title(job.task),
      ...(job.startedAt === null ? {} : { startedAt: job.startedAt }),
    };
    if (job.state === 'queued' || job.state === 'running') {
      live.push(item);
    } else if (recent(job.finishedAt)) {
      finished.push({
        ...item,
        finishedAt: job.finishedAt!,
        ...(job.note ? { note: clip(oneLine(job.note), NOTE_CHARS) } : {}),
        ...(job.error ? { error: clip(oneLine(job.error), NOTE_CHARS) } : {}),
        ...(job.reportedAt === null ? {} : { told: true }),
      });
    }
  }
  live.sort((a, b) => (a.state === b.state ? 0 : a.state === 'running' ? -1 : 1));
  for (const expert of src.experts) {
    live.push({
      id: shortId('h', expert.handoffId),
      ref: expert.handoffId,
      kind: 'expert',
      state: 'running',
      title: title(`${expert.expertName}: ${firstParagraph(expert.ask)}`),
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
    title: title(`${brief.expertName}: ${firstParagraph(brief.ask)}`),
  }));

  for (const row of src.finished) {
    if (row.kind !== 'expert' && row.kind !== 'routine') continue;
    if (row.state === 'running' || !recent(row.finishedAt)) continue;
    const answer = row.answer === undefined ? '' : firstParagraph(row.answer).split('\n')[0]!;
    finished.push({
      id: shortId(row.kind === 'expert' ? 'h' : 'r', row.id),
      ref: row.id,
      kind: row.kind,
      state: row.state,
      title:
        row.kind === 'expert'
          ? title(`${row.expertName ?? 'An expert'}: ${firstParagraph(row.text ?? '')}`)
          : title(`Routine ${row.text ?? ''}`),
      finishedAt: row.finishedAt!,
      ...(answer.trim() === '' ? {} : { note: clip(oneLine(answer), NOTE_CHARS) }),
      ...(row.error ? { error: clip(oneLine(row.error), NOTE_CHARS) } : {}),
    });
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
  const live = items.filter((item) => item.state === 'running' || item.state === 'queued');
  const waiting = items.filter((item) => item.state === 'waiting');
  const finished = items.filter((item) => item.finishedAt !== undefined);
  if (items.length === 0) return 'Nothing is running and nothing finished today.';

  const lines: string[] = [];
  if (live.length > 0) {
    lines.push('Working now:', ...live.map((item) => `- ${liveLine(item, now)}`));
    const counts = jobCounts(live, options.capacity);
    if (counts !== null) lines.push(counts);
  }
  if (waiting.length > 0) {
    lines.push('Waiting for their Send:', ...waiting.map((item) => `- ${item.title}`));
  }
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
 * prefix. Two matches come back as ambiguous; none as null.
 */
export function resolveId(
  items: readonly BoardItem[],
  id: string,
): BoardItem | { ambiguous: BoardItem[] } | null {
  const wanted = id.trim().toLowerCase();
  if (wanted === '') return null;
  const named = items.filter((item) => item.id !== undefined);
  const exact = named.filter((item) => item.id === wanted || item.ref === wanted);
  const prefix = /^([jhwr])-/.exec(wanted)?.[1];
  const hex = wanted.replace(/^[jhwr]-/, '').replace(/-/g, '');
  const matches =
    exact.length > 0
      ? exact
      : named.filter(
          (item) =>
            hex.length > 0 &&
            (prefix === undefined || item.id!.startsWith(`${prefix}-`)) &&
            item.ref.replace(/-/g, '').startsWith(hex),
        );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;
  return { ambiguous: matches };
}

/** A longer id for an ambiguous match: the prefix and eight hex. */
export function longId(item: BoardItem): string {
  return `${item.id!.slice(0, 2)}${item.ref.replace(/-/g, '').slice(0, 8)}`;
}

function liveLine(item: BoardItem, now: Date): string {
  switch (item.kind) {
    case 'job':
      return item.state === 'queued'
        ? `${item.id} your job, waiting to start: ${item.title}`
        : `${item.id} your job, running${since(item.startedAt, now)}: ${item.title}`;
    case 'expert':
      return `${item.id} ${item.title}, running`;
    case 'watch':
      return `${item.id} watching for "${item.title}" (${item.progress})`;
    case 'routine':
      return `${item.title}, running`;
  }
}

function finishedLine(item: BoardItem, timeZone: string | undefined): string {
  const how = item.state === 'error' ? 'failed' : item.state;
  const when = `${how} ${clock(item.finishedAt!, timeZone)}${item.told === true ? ' (mentioned)' : ''}`;
  const head =
    item.kind === 'job'
      ? `${item.id} your job, ${when}: ${item.title}`
      : `${item.id} ${item.title}, ${when}`;
  return `${head}${item.note ? `. Note: ${item.note}` : ''}${item.error ? `. Error: ${item.error}` : ''}`;
}

/** "Your jobs: 2 running, 1 waiting." and why fewer run, when any wait or the machine is busy. */
function jobCounts(live: readonly BoardItem[], capacity: Capacity | undefined): string | null {
  const running = live.filter((item) => item.kind === 'job' && item.state === 'running').length;
  const queued = live.filter((item) => item.kind === 'job' && item.state === 'queued').length;
  if (running + queued === 0 || (queued === 0 && capacity?.busy === undefined)) return null;
  const head = `Your jobs: ${running} running, ${queued} waiting.`;
  if (capacity?.busy === undefined) return `${head} At most 3 run at a time.`;
  return `${head} ${busyLine(capacity)}`;
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

function since(startedAt: string | undefined, now: Date): string {
  if (startedAt === undefined) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / 60_000));
  return ` ${minutes} min`;
}

function clock(iso: string, timeZone: string | undefined): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone === undefined ? {} : { timeZone }),
  });
}

function firstParagraph(text: string): string {
  return (text.split(/\n\s*\n/)[0] ?? '').trim();
}

function title(text: string): string {
  return clip(oneLine(hideSecrets(text)), TITLE_CHARS);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
