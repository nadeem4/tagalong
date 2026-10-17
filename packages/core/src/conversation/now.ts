/**
 * The "Now" block: facts about this moment that ride at the end of the person's message, so
 * the system prompt stays the same on every turn. Contains the facts' types, `gatherNow`
 * (reads them from the engine's sources), `renderNow` and `renderMemories`. Facts only: the
 * model decides what, if anything, to make of them.
 */
import { busyLine } from '../jobs/board';
import type { Capacity } from '../jobs/jobs';
import type { Memory } from '../memory/memories';
import { hideSecrets } from '../privacy/secrets';

/** One expert and the first part of what it was asked. */
export interface ExpertLine {
  /** Its short id on the board (`h-91ab`), when it can be named. */
  id?: string | undefined;
  expertName: string;
  ask: string;
}

export type FinishedLine = ExpertLine & { state: 'done' | 'stopped' | 'error' };

/** One of Scout's own jobs, by its short id (`j-7f3a`). */
export interface JobLine {
  id: string;
  task: string;
  state: 'running' | 'done' | 'error';
  startedAt?: string | undefined;
  /** A finished job's gist, or why it failed. */
  note?: string | undefined;
}

/** Scout's own jobs: running, how many wait (and why, when the machine allows fewer), finished. */
export interface JobFacts {
  running: readonly JobLine[];
  queued: number;
  capacity?: Capacity | undefined;
  /** Finished since the last talk. */
  finished: readonly JobLine[];
}

/** Why the mind woke. A check-in says why in its own bundle, so Now adds no line for it. */
export type WakeReason =
  | { kind: 'asked'; spoken: boolean }
  | { kind: 'routine'; name: string }
  | { kind: 'job'; task: string }
  | { kind: 'check-in' };

export interface NowFacts {
  at: Date;
  timeZone: string;
  reason: WakeReason;
  /** ISO time of the previous turn, or null on the first one. */
  lastTalkAt: string | null;
  running: readonly ExpertLine[];
  finished: readonly FinishedLine[];
  /** Briefs waiting for Send. Routine and settings cards are not tracked in core. */
  waiting: readonly ExpertLine[];
  /** Absent with no jobs source. */
  jobs?: JobFacts | undefined;
}

/** Everything optional but the clock, so turn-mechanics tests need no sources. */
export interface NowSources {
  clock(): Date;
  timeZone?(): string;
  lastTalkAt?(petId: string): string | null;
  running?(): readonly ExpertLine[];
  waiting?(): readonly ExpertLine[];
  finishedSince?(iso: string): readonly FinishedLine[];
  /** Scout's own jobs; `finished` holds those finished after `lastTalkAt`. */
  jobs?(lastTalkAt: string | null): JobFacts;
}

export const NOW_HEADING = '## Now';
export const MEMORY_HEADING = '## What you remember';

/** The memory section never grows past this, heading included. */
const MAX_MEMORY_SECTION_CHARS = 2000;

/** An ask is a reminder of which job, not the job: one short line. */
const ASK_CHARS = 100;

const JOB_LINE =
  'Background work you started for them. Nobody is watching, so ask no questions; your ' +
  'answer comes back to you, not to them. Begin with one line that gives the gist.';

const SPOKEN_LINE =
  'Spoken: they said this out loud and your words are read aloud as you write them. No ' +
  'markdown, lists or links in what you say; put exact detail (code, steps) after, where it ' +
  'shows in the bubble and is not read. Speech recognition may have misheard a word.';

/**
 * Reads the facts for this turn. A source that throws is left out (its line goes with it):
 * a closed database must not stop the person getting an answer.
 */
export function gatherNow(sources: NowSources, petId: string, reason: WakeReason): NowFacts {
  const lastTalkAt = safe(() => sources.lastTalkAt?.(petId) ?? null, null);
  return {
    at: sources.clock(),
    timeZone: safe(() => sources.timeZone?.() ?? runtimeTimeZone(), runtimeTimeZone()),
    reason,
    lastTalkAt,
    running: safe(() => sources.running?.() ?? [], []),
    finished: lastTalkAt === null ? [] : safe(() => sources.finishedSince?.(lastTalkAt) ?? [], []),
    waiting: safe(() => sources.waiting?.() ?? [], []),
    ...(sources.jobs === undefined
      ? {}
      : { jobs: safe(() => sources.jobs!(lastTalkAt), { running: [], queued: 0, finished: [] }) }),
  };
}

/** The "## Now" block. Empty sections are left out, never said as "nothing is running". */
export function renderNow(facts: NowFacts): string {
  const lines = [NOW_HEADING, `${localTime(facts.at, facts.timeZone)}.`];

  const since = facts.lastTalkAt === null ? null : sinceText(facts.at, facts.lastTalkAt);
  if (since !== null) lines.push(`You last talked ${since}.`);

  if (facts.reason.kind === 'routine') {
    lines.push(
      `A routine, "${clean(facts.reason.name)}", is running on its own: nobody is watching, ` +
        'so ask no questions; they read the answer later.',
    );
  } else if (facts.reason.kind === 'job') {
    lines.push(JOB_LINE);
  } else if (facts.reason.kind === 'asked' && facts.reason.spoken) {
    lines.push(SPOKEN_LINE);
  }

  const jobs = facts.jobs;
  if (jobs !== undefined && jobs.running.length > 0) {
    const working = jobs.running
      .map((job) => `${job.id} "${clip(clean(job.task))}"${minutesSince(facts.at, job.startedAt)}`)
      .join('; ');
    let line = `You are working on: ${working}.`;
    if (jobs.queued > 0) {
      line += ` ${jobs.queued} more waiting to start.`;
      if (jobs.capacity?.busy !== undefined) line += ` ${busyLine(jobs.capacity)}`;
    }
    lines.push(line);
  }
  if (jobs !== undefined && jobs.finished.length > 0) {
    const done = jobs.finished
      .map((job) => {
        const head = `${job.id} "${clip(clean(job.task))}" (${job.state === 'error' ? 'failed' : 'done'})`;
        return job.note ? `${head}: ${clean(job.note)}` : head;
      })
      .join('; ');
    lines.push(`Your jobs finished since you last talked: ${done}.`);
  }

  if (facts.running.length > 0) lines.push(`Experts working: ${expertList(facts.running)}.`);
  if (facts.finished.length > 0) {
    const finished = facts.finished
      .map((line) => `${expertLine(line)} (${line.state === 'error' ? 'failed' : line.state})`)
      .join('; ');
    lines.push(`Finished since you last talked: ${finished}.`);
  }
  if (facts.waiting.length > 0) lines.push(`Waiting for their Send: ${expertList(facts.waiting)}.`);

  return lines.join('\n');
}

/** "## What you remember", one `(kind) text` line each. A line that would not fit is skipped. */
export function renderMemories(memories: readonly Memory[]): string {
  const lines = [MEMORY_HEADING];
  let length = MEMORY_HEADING.length;
  for (const memory of memories) {
    const line = `- (${memory.kind}) ${memory.text}`;
    if (length + 1 + line.length > MAX_MEMORY_SECTION_CHARS) continue;
    lines.push(line);
    length += 1 + line.length;
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

/** A source that throws (a store closed under it) reads as the fallback. */
export function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function runtimeTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "Friday 16 October, 21:40, Europe/London", or in UTC for a zone the runtime does not know. */
function localTime(at: Date, timeZone: string): string {
  let zone = timeZone;
  let format: Intl.DateTimeFormat;
  try {
    format = dateFormat(zone);
  } catch {
    zone = 'UTC';
    format = dateFormat(zone);
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    format.formatToParts(at).find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}, ${zone}`;
}

function dateFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
}

/** "25 minutes ago", "3 hours ago", "3 days ago"; null for a time that does not parse. */
function sinceText(at: Date, iso: string): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.floor((at.getTime() - then) / 60_000));
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${count(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${count(hours, 'hour')} ago`;
  return `${count(Math.floor(hours / 24), 'day')} ago`;
}

function count(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function expertList(lines: readonly ExpertLine[]): string {
  return lines.map(expertLine).join('; ');
}

function expertLine(line: ExpertLine): string {
  const id = line.id === undefined ? '' : `${line.id} `;
  return `${id}${clean(line.expertName)}: "${clip(clean(line.ask.split(/\n\s*\n/)[0] ?? ''))}"`;
}

/** " (4 min)" since a job started; nothing for a time that is missing or does not parse. */
function minutesSince(at: Date, iso: string | undefined): string {
  const then = iso === undefined ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(then)) return '';
  return ` (${Math.max(0, Math.floor((at.getTime() - then) / 60_000))} min)`;
}

/** Secrets hidden, on one line. */
function clean(text: string): string {
  return hideSecrets(text).replace(/\s+/g, ' ').trim();
}

function clip(text: string): string {
  return text.length <= ASK_CHARS ? text : `${text.slice(0, ASK_CHARS - 1)}…`;
}
