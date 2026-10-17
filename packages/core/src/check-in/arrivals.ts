/**
 * Finished work, gathered: Scout's own jobs and expert hand-offs that come back are held for
 * a short quiet window and through calls, full screen or a conversation, then handed to the
 * check-in once, all together. Contains `Arrivals`, `Arrival` and the timings. WHEN only:
 * how (and whether) to report them is the mind's.
 */
import type { HandoffFinishedParams, WindowEntry } from '@tagalong/protocol';
import { shortId } from '../jobs/board';
import { NOTE_CHARS, clip } from '../jobs/jobs';
import type { JobRow } from '../jobs/store';
import { callOrFullScreenInFront } from '../keep-an-eye/lookout';
import type { WatchClock } from '../watch/watch-manager';

/** Quiet time after the latest arrival. */
export const ARRIVAL_WINDOW_MS = 20_000;
/** From the first arrival, unless held. */
export const ARRIVAL_MAX_WAIT_MS = 60_000;
/** How often a held batch looks again. */
export const HOLD_RECHECK_MS = 15_000;
/** After the person's own turn ends, the conversation still counts as going on. */
export const AFTER_TALK_MS = 30_000;
/** An ask is a reminder of which job, not the job. */
const TITLE_CHARS = 100;

/** One finished thing, by its short id on the board. */
export interface Arrival {
  id: string;
  kind: 'job' | 'expert';
  /** The job's task, or the expert and its ask. */
  title: string;
  state: 'done' | 'error';
  /** The gist, the answer's first line, or why it failed. */
  note: string;
  /** An expert's whole answer: its tail is read when it comes back alone. */
  detail?: string | undefined;
  handoffId?: string | undefined;
  jobId?: string | undefined;
}

/**
 * A hand-off that came back: null for a stopped one (they stopped it) and for a step that
 * hands on to another (only a chain's last step arrives).
 */
export function fromHandoff(
  params: HandoffFinishedParams,
  handoff: { expertName: string; ask: string } | null,
): Arrival | null {
  if (params.next !== undefined || params.state === 'stopped') return null;
  const ask = (handoff?.ask.split(/\n\s*\n/)[0] ?? '').replace(/\s+/g, ' ').trim();
  const text = params.text ?? '';
  return {
    id: shortId('h', params.handoffId),
    kind: 'expert',
    title: `${handoff?.expertName ?? 'An expert'}: "${clip(ask, TITLE_CHARS)}"`,
    state: params.state,
    note: clip(params.state === 'error' ? (params.error ?? '') : firstLine(text), NOTE_CHARS),
    detail: text,
    handoffId: params.handoffId,
  };
}

/** A job of Scout's that came back done or failed. */
export function fromJob(row: JobRow): Arrival {
  return {
    id: shortId('j', row.id),
    kind: 'job',
    title: row.task,
    state: row.state === 'error' ? 'error' : 'done',
    note: (row.state === 'error' ? row.error : row.note) ?? '',
    jobId: row.id,
  };
}

function firstLine(text: string): string {
  return (text.split('\n').find((line) => line.trim() !== '') ?? '').trim();
}

export interface ArrivalsOptions {
  clock: WatchClock;
  /** What is open; null with no host connected. */
  windows: () => Promise<readonly WindowEntry[] | null>;
  /** A turn of theirs is running, or one ended under `AFTER_TALK_MS` ago. */
  talking: () => boolean;
  /** The check-in. False: one was already running, so the batch waits and tries again. */
  wake: (batch: readonly Arrival[]) => Promise<boolean>;
  log?: ((message: string) => void) | undefined;
}

export class Arrivals {
  readonly #o: ArrivalsOptions;
  #batch: Arrival[] = [];
  #first = 0;
  #latest = 0;
  #timer: unknown = null;
  #waking = false;
  #stopped = false;

  constructor(options: ArrivalsOptions) {
    this.#o = options;
  }

  add(item: Arrival): void {
    if (this.#stopped) return;
    const now = this.#o.clock.now();
    if (this.#batch.length === 0) this.#first = now;
    this.#latest = now;
    this.#batch.push(item);
    // Arrivals during a wake are the next batch, timed once the wake is over.
    if (!this.#waking) this.#schedule(this.#due() - now);
  }

  stop(): void {
    this.#stopped = true;
    this.#batch = [];
    this.#cancel();
  }

  #due(): number {
    return Math.min(this.#latest + ARRIVAL_WINDOW_MS, this.#first + ARRIVAL_MAX_WAIT_MS);
  }

  #schedule(ms: number): void {
    this.#cancel();
    this.#timer = this.#o.clock.setTimeout(() => void this.#fire(), Math.max(0, ms));
  }

  #cancel(): void {
    if (this.#timer !== null) this.#o.clock.clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #fire(): Promise<void> {
    this.#timer = null;
    if (this.#stopped || this.#batch.length === 0) return;
    this.#waking = true;
    let batch: Arrival[] = [];
    let taken = false;
    try {
      // No limit on holding: nothing is lost, and Now carries what is not mentioned yet.
      const held = this.#o.talking() || callOrFullScreenInFront((await this.#o.windows()) ?? []);
      if (!held) {
        batch = this.#batch;
        this.#batch = [];
        taken = await this.#o.wake(batch);
      }
    } catch (error) {
      this.#o.log?.(`arrivals: ${String(error)}`);
    } finally {
      this.#waking = false;
    }
    if (this.#stopped) return;
    if (!taken) {
      this.#batch = [...batch, ...this.#batch];
      this.#schedule(HOLD_RECHECK_MS);
    } else if (this.#batch.length > 0) {
      this.#schedule(this.#due() - this.#o.clock.now());
    }
  }
}
