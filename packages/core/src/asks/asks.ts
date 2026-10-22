/**
 * Everything that waits on the person, saved: a change in a connected app (held: its turn
 * awaits it) and a hand-off card (free: nothing awaits it). Contains Asks, AskEvent and the
 * two expiry constants. Replaces the in-memory approvals; the engine builds one.
 */
import { randomUUID } from 'node:crypto';
import type {
  Ask,
  AskNote,
  AskRisk,
  AskState,
  AsksChangedParams,
  AsksListResult,
  ConnectorConfirmParams,
} from '@tagalong/protocol';
import type { AskRecord, AskStore } from './store';

/** A change in an app waits this long: its turn is held open the whole time. */
export const HELD_ASK_MS = 60 * 60_000;

/** A hand-off card waits this long: a brief about yesterday's problem goes stale. */
export const FREE_ASK_MS = 24 * 60 * 60_000;

/** How an ask ended. Only `approved` runs anything, and only a person's click sets it. */
export type AskAnswer = Exclude<AskState, 'waiting'>;

export type AskEvent =
  | { method: 'connector.confirm'; params: ConnectorConfirmParams }
  | { method: 'asks.changed'; params: AsksChangedParams };

export interface AsksOptions {
  store: AskStore;
  emit: (event: AskEvent) => void;
  /** What came of an ask, on the episode of the turn that asked. */
  outcome: (turnId: string, name: AskAnswer) => void;
  /** An expert's name for the list; undefined once it is gone. */
  expertName?: (expertId: string) => string | undefined;
}

/**
 * The asks. `hold` saves an app change, shows its confirm card and resolves when it ends;
 * `add` saves a hand-off card. Each waiting ask has a timer at its expiry; `boot` ends held
 * asks a quit left behind (their turn is gone, so nothing can run them) and re-arms the rest.
 * Every change is one compare-and-set `settle`, followed by the outcome on the episode and an
 * `asks.changed` broadcast.
 */
export class Asks {
  /** Held asks: id to the resolver of the turn that awaits it. */
  readonly #held = new Map<string, (answer: AskAnswer) => void>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: AsksOptions) {}

  hold(
    params: {
      turnId: string;
      petId: string;
      app: string;
      tool: string;
      summary: string;
      risk: AskRisk;
    },
    signal: AbortSignal,
  ): Promise<AskAnswer> {
    const id = randomUUID();
    const now = Date.now();
    this.options.store.insert({
      id,
      kind: 'app-change',
      petId: params.petId,
      summary: params.summary,
      risk: params.risk,
      app: params.app,
      tool: params.tool,
      originTurnId: params.turnId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + HELD_ASK_MS).toISOString(),
    });
    return new Promise((resolve) => {
      const onAbort = () => this.settle(id, 'cancelled', { note: 'turn-ended' });
      this.#held.set(id, (answer) => {
        signal.removeEventListener('abort', onAbort);
        resolve(answer);
      });
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      this.#arm(id, now + HELD_ASK_MS);
      this.options.emit({
        method: 'connector.confirm',
        params: { approvalId: id, ...params },
      });
      this.#changed();
    });
  }

  /** A hand-off card, waiting for Send with a folder. Nothing awaits it. */
  add(params: {
    petId: string;
    expertId: string;
    summary: string;
    payload: unknown;
    originTurnId?: string | undefined;
  }): { id: string } {
    const id = randomUUID();
    const now = Date.now();
    this.options.store.insert({
      id,
      kind: 'handoff',
      petId: params.petId,
      summary: params.summary,
      risk: 'change',
      expertId: params.expertId,
      ...(params.originTurnId === undefined ? {} : { originTurnId: params.originTurnId }),
      payload: params.payload,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + FREE_ASK_MS).toISOString(),
    });
    this.#arm(id, now + FREE_ASK_MS);
    this.#changed();
    return { id };
  }

  /**
   * A click on Allow once or Decline, by the person. A hand-off is never approved here: Send
   * needs a folder, so it goes through its card. False when it no longer waits.
   */
  answer(id: string, decision: 'approve' | 'decline'): boolean {
    const row = this.options.store.get(id);
    if (row?.state !== 'waiting') return false;
    if (row.kind === 'handoff' && decision === 'approve') return false;
    return this.settle(id, decision === 'approve' ? 'approved' : 'declined', { by: 'you' });
  }

  /** Ends a waiting ask. False when it was already answered: the other answer won. */
  settle(id: string, state: AskAnswer, how: { by?: 'you'; note?: AskNote } = {}): boolean {
    const row = this.options.store.get(id);
    if (!this.options.store.settle(id, state, how)) return false;
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    const finish = this.#held.get(id);
    this.#held.delete(id);
    finish?.(state);
    if (row?.originTurnId !== undefined) this.options.outcome(row.originTurnId, state);
    this.#changed();
    return true;
  }

  get(id: string): AskRecord | null {
    return this.options.store.get(id);
  }

  waiting(): AskRecord[] {
    return this.options.store.waiting();
  }

  /** Home's Waiting on you: what waits and the last 20 answered. */
  list(): AsksListResult {
    return {
      waiting: this.options.store.waiting().map((row) => this.#view(row)),
      recent: this.options.store.recent().map((row) => this.#view(row)),
    };
  }

  /**
   * At launch. A held ask still waiting was left by a quit or a crash: its turn is gone, so it
   * ends expired, closed, and nothing runs. A card past its time expires; the rest wait on.
   */
  boot(): void {
    const now = Date.now();
    for (const row of this.options.store.waiting()) {
      const expiresAt = row.expiresAt === undefined ? Infinity : Date.parse(row.expiresAt);
      if (row.kind === 'app-change') this.settle(row.id, 'expired', { note: 'closed' });
      else if (expiresAt <= now) this.settle(row.id, 'expired', { note: 'expired' });
      else this.#arm(row.id, expiresAt);
    }
  }

  /** On quit, before the turns are stopped: held asks end expired, closed, not cancelled. */
  closeHeld(): void {
    for (const row of this.options.store.waiting()) {
      if (row.kind === 'app-change') this.settle(row.id, 'expired', { note: 'closed' });
    }
  }

  /** Answered asks older than 30 days go. */
  prune(): number {
    return this.options.store.prune();
  }

  /** Delete all: answered asks go; what waits stays. */
  clear(): number {
    return this.options.store.clear();
  }

  /** Shutdown: no timer fires once the database is closed. */
  stop(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  #arm(id: string, at: number): void {
    clearTimeout(this.#timers.get(id));
    const timer = setTimeout(
      () => {
        this.#timers.delete(id);
        this.settle(id, 'expired', { note: 'expired' });
      },
      Math.max(0, at - Date.now()),
    );
    timer.unref?.();
    this.#timers.set(id, timer);
  }

  #changed(): void {
    this.options.emit({
      method: 'asks.changed',
      params: { waiting: this.options.store.waiting().map((row) => this.#view(row)) },
    });
  }

  #view(row: AskRecord): Ask {
    const { expertId, payload: _payload, ...rest } = row;
    const expertName = expertId === undefined ? undefined : this.options.expertName?.(expertId);
    return { ...rest, ...(expertName === undefined ? {} : { expertName }) };
  }
}
