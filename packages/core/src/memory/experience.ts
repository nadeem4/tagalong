/**
 * The experience log: every decision the mind made and what came of it, so it can be
 * inspected now and learned from later. Contains ExperienceLog and its limits.
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  Episode,
  EpisodeDecision,
  EpisodeEvent,
  EpisodeMode,
  ExperienceGetResult,
  ExperienceListResult,
} from '@tagalong/protocol';
import type { TurnEvent } from '../conversation/runner';
import { hideSecrets } from '../privacy/secrets';
import { RECALL_SCREEN, WHAT_CHANGED } from '../tools/builtin/awareness';
import {
  GET_SELECTION,
  LIST_WINDOWS,
  LOOK_AT_DISPLAY,
  LOOK_AT_SCREEN,
  LOOK_AT_WINDOW,
  LOOK_CLOSER,
  READ_WINDOW_TEXT,
} from '../tools/builtin/perception';
import type { ConversationStore } from './store';

/** What the mind was shown: a question, or a check-in's whole bundle. */
export const EXPERIENCE_INPUT_CHARS = 8_000;
/** What it said, a tool's input, a note. */
const TEXT_CHARS = 4_000;
/** The experience log keeps this many days. */
export const EXPERIENCE_KEEP_DAYS = 30;
/** Hand-off cards waiting for Send, tied to the turn that proposed them; the oldest go first. */
const WAITING_CARDS = 50;

/**
 * Tools whose results are what is on the screen: window text, OCR, the selection, window
 * titles, what a look saw. The log keeps only how much there was, never the text.
 */
const SCREEN_TOOLS: ReadonlySet<string> = new Set([
  LOOK_AT_SCREEN,
  GET_SELECTION,
  LOOK_AT_DISPLAY,
  LOOK_CLOSER,
  LIST_WINDOWS,
  READ_WINDOW_TEXT,
  LOOK_AT_WINDOW,
  RECALL_SCREEN,
  WHAT_CHANGED,
]);

/** What stands in for screen text the log does not keep. */
export function notKept(text: string): string {
  return `[screen text, ${text.length.toLocaleString('en-GB')} characters, not kept]`;
}

interface EpisodeRow {
  id: string;
  mode: string;
  trigger: string;
  pet_id: string;
  ref: string | null;
  conversation_id: string | null;
  model: string | null;
  input: string | null;
  decision: string | null;
  said: string | null;
  note: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model_calls: number | null;
  started_at: string;
  ended_at: string | null;
}

interface EventRow {
  kind: string;
  name: string;
  input: string | null;
  result: string | null;
  ok: number | null;
  at: string;
}

/** One check-in, recorded once the mind has answered (or failed to). */
export interface CheckInEpisode {
  /** The remark's id, which Not now and an accepted offer come back with. */
  ref: string;
  petId: string;
  /** The reason it woke: `trouble`, `settled`, `launch`… */
  trigger: string;
  model?: string | undefined;
  /** The bundle the mind was shown, with screen text and window titles already left out. */
  input: string;
  decision: Extract<EpisodeDecision, 'quiet' | 'spoke' | 'offered' | 'no-answer' | 'held'>;
  said?: string | undefined;
  /** The offer, when one was shown. */
  note?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}

/**
 * The record behind the inspector, and later the input to sleep and the evals. Turns, jobs
 * and routine runs are written from the turn events the engine already sends (`observe` sits
 * in front of the broadcast, beside the activity log); check-ins, outcomes and hand-off cards
 * by their own hooks. Everything kept has secrets hidden and is clipped; pictures, screen text
 * and window titles are never kept. Local only, and gone after EXPERIENCE_KEEP_DAYS or Delete
 * all.
 */
export class ExperienceLog {
  /** Running turns: turn id to episode id. */
  readonly #open = new Map<string, { episodeId: string; petId: string }>();
  /** Hand-off cards a turn proposed, still waiting: proposal id to that turn's episode id. */
  readonly #proposals = new Map<string, string>();

  constructor(
    private readonly db: Database.Database,
    private readonly store: ConversationStore,
  ) {}

  observe(event: TurnEvent): void {
    switch (event.method) {
      case 'turn.started': {
        const { turnId, petId, conversationId, model, jobId, routineId, spoken } = event.params;
        const mode: EpisodeMode =
          jobId !== undefined ? 'job' : routineId !== undefined ? 'routine' : 'turn';
        const episodeId = this.#insert({
          mode,
          trigger: mode !== 'turn' ? mode : spoken === true ? 'voice' : 'asked',
          petId,
          ref: turnId,
          conversationId,
          model,
          input: this.#question(conversationId),
        });
        this.#open.set(turnId, { episodeId, petId });
        return;
      }
      case 'turn.toolRequest': {
        const open = this.#open.get(event.params.turnId);
        if (open === undefined) return;
        this.db
          .prepare(
            `INSERT INTO episode_events (episode_id, kind, name, call_id, input, at)
             VALUES (?, 'step', ?, ?, ?, ?)`,
          )
          .run(
            open.episodeId,
            event.params.tool,
            event.params.callId ?? null,
            clip(JSON.stringify(event.params.input ?? null), TEXT_CHARS),
            now(),
          );
        return;
      }
      case 'turn.toolResult': {
        const open = this.#open.get(event.params.turnId);
        if (open === undefined) return;
        const { tool, callId, summary } = event.params;
        const result = SCREEN_TOOLS.has(tool) && summary !== '' ? notKept(summary) : summary;
        // Its own call, by the provider's id; with none, the newest unanswered call of that tool.
        this.db
          .prepare(
            `UPDATE episode_events SET ok = ?, result = ?
             WHERE id = (SELECT MAX(id) FROM episode_events
                         WHERE episode_id = ? AND kind = 'step' AND name = ? AND ok IS NULL
                           AND (? IS NULL OR call_id = ?))`,
          )
          .run(
            event.params.ok ? 1 : 0,
            clip(result, TEXT_CHARS),
            open.episodeId,
            tool,
            callId ?? null,
            callId ?? null,
          );
        return;
      }
      case 'turn.completed': {
        const open = this.#close(event.params.turnId);
        if (open === undefined) return;
        const { text, stopReason, usage, modelCalls } = event.params;
        this.db
          .prepare(
            `UPDATE episodes SET decision = ?, said = ?, note = ?, input_tokens = ?,
               output_tokens = ?, model_calls = ?, ended_at = ?
             WHERE id = ?`,
          )
          .run(
            stopReason === 'aborted' ? 'stopped' : 'answered',
            clip(text, TEXT_CHARS),
            stopReason === 'end' || stopReason === 'aborted' ? null : stopReason,
            usage.inputTokens,
            usage.outputTokens,
            modelCalls ?? null,
            now(),
            open,
          );
        return;
      }
      case 'turn.error': {
        const open = this.#close(event.params.turnId);
        if (open === undefined) return;
        this.db
          .prepare(`UPDATE episodes SET decision = 'error', note = ?, ended_at = ? WHERE id = ?`)
          .run(clip(event.params.message, TEXT_CHARS), now(), open);
        return;
      }
      default:
        return;
    }
  }

  /** One check-in, silence included: what it was shown, what it decided, what it said. */
  checkIn(entry: CheckInEpisode): string {
    const id = this.#insert({ mode: 'check-in', ...entry });
    this.db
      .prepare(
        `UPDATE episodes SET decision = ?, said = ?, note = ?, input_tokens = ?, output_tokens = ?,
           model_calls = ?, ended_at = ?
         WHERE id = ?`,
      )
      .run(
        entry.decision,
        clip(entry.said, TEXT_CHARS),
        clip(entry.note, TEXT_CHARS),
        entry.inputTokens ?? null,
        entry.outputTokens ?? null,
        entry.inputTokens === undefined ? null : 1,
        now(),
        id,
      );
    return id;
  }

  /**
   * What the person did about an episode, matched on its ref (a remark or turn id): Not now,
   * an offer accepted. False when no episode has that ref, such as one already pruned.
   */
  outcome(ref: string, name: string): boolean {
    const row = this.db
      .prepare<[string], { id: string }>(
        'SELECT id FROM episodes WHERE ref = ? ORDER BY rowid DESC LIMIT 1',
      )
      .get(ref);
    if (row === undefined) return false;
    this.#outcome(row.id, name);
    return true;
  }

  /**
   * A turn's tool put a hand-off card up: tied to that turn. A card from anywhere else (a
   * check-in offer taken, Brief again) or from a turn already gone is tied to nothing.
   */
  proposed(proposalId: string, turnId: string | undefined): void {
    const open = turnId === undefined ? undefined : this.#open.get(turnId);
    if (open === undefined) return;
    this.#proposals.set(proposalId, open.episodeId);
    // Cards never sent nor dismissed (the window closed) would otherwise pile up.
    for (const oldest of this.#proposals.keys()) {
      if (this.#proposals.size <= WAITING_CARDS) break;
      this.#proposals.delete(oldest);
    }
  }

  /** The person sent or dismissed a hand-off card. False when no turn proposed it. */
  proposalOutcome(proposalId: string, name: 'sent' | 'dismissed'): boolean {
    const episodeId = this.#proposals.get(proposalId);
    if (episodeId === undefined) return false;
    this.#proposals.delete(proposalId);
    this.#outcome(episodeId, name);
    return true;
  }

  list(params: { before?: string | undefined; limit?: number | undefined }): ExperienceListResult {
    const limit = params.limit ?? 30;
    const cursor =
      params.before === undefined
        ? undefined
        : this.db
            .prepare<[string], { rowid: number }>('SELECT rowid FROM episodes WHERE id = ?')
            .get(params.before)?.rowid;
    const rows = this.db
      .prepare<[number, number], EpisodeRow>(
        'SELECT * FROM episodes WHERE rowid < ? ORDER BY rowid DESC LIMIT ?',
      )
      .all(cursor ?? Number.MAX_SAFE_INTEGER, limit + 1);
    const episodes = rows.slice(0, limit).map(toEpisode);
    const last = episodes.at(-1);
    return rows.length > limit && last !== undefined ? { episodes, next: last.id } : { episodes };
  }

  get(id: string): ExperienceGetResult {
    const row = this.db
      .prepare<[string], EpisodeRow>('SELECT * FROM episodes WHERE id = ?')
      .get(id);
    if (row === undefined) return null;
    const events = this.db
      .prepare<[string], EventRow>(
        `SELECT kind, name, input, result, ok, at FROM episode_events
         WHERE episode_id = ? ORDER BY id`,
      )
      .all(id)
      .map(toEvent);
    return { episode: toEpisode(row), events };
  }

  /** At boot nothing runs, so an episode still open was cut short by a quit or a crash. */
  interrupted(): number {
    return this.db
      .prepare(`UPDATE episodes SET decision = 'stopped', ended_at = ? WHERE decision IS NULL`)
      .run(now()).changes;
  }

  /** Delete all: every episode and its events. Returns how many episodes went. */
  clear(): number {
    this.#proposals.clear();
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM episode_events').run();
      return this.db.prepare('DELETE FROM episodes').run().changes;
    })();
  }

  /** Forgets episodes older than EXPERIENCE_KEEP_DAYS, and their events with them. */
  prune(): number {
    const cutoff = new Date(Date.now() - EXPERIENCE_KEEP_DAYS * 86_400_000).toISOString();
    return this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM episode_events
           WHERE episode_id IN (SELECT id FROM episodes WHERE started_at < ?)`,
        )
        .run(cutoff);
      return this.db.prepare('DELETE FROM episodes WHERE started_at < ?').run(cutoff).changes;
    })();
  }

  #insert(entry: {
    mode: EpisodeMode;
    trigger: string;
    petId: string;
    ref?: string | undefined;
    conversationId?: string | undefined;
    model?: string | undefined;
    input?: string | undefined;
  }): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO episodes (id, mode, trigger, pet_id, ref, conversation_id, model, input,
           started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.mode,
        entry.trigger,
        entry.petId,
        entry.ref ?? null,
        entry.conversationId ?? null,
        entry.model ?? null,
        clip(entry.input, EXPERIENCE_INPUT_CHARS),
        now(),
      );
    return id;
  }

  #outcome(episodeId: string, name: string): void {
    this.db
      .prepare(
        `INSERT INTO episode_events (episode_id, kind, name, at) VALUES (?, 'outcome', ?, ?)`,
      )
      .run(episodeId, name, now());
  }

  /** Forgets a running turn and returns its episode id. */
  #close(turnId: string): string | undefined {
    const open = this.#open.get(turnId);
    this.#open.delete(turnId);
    return open?.episodeId;
  }

  /** The runner stores the question before it announces the turn. */
  #question(conversationId: string): string | undefined {
    const last = this.store.lastMessages(conversationId, 1)[0];
    if (last?.role !== 'user') return undefined;
    return last.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  }
}

/** Secrets hidden, then cut to `max` characters. */
function clip(text: string | undefined, max: number): string | null {
  if (text === undefined || text.length === 0) return null;
  const hidden = hideSecrets(text);
  return hidden.length <= max ? hidden : `${hidden.slice(0, max - 1)}…`;
}

function now(): string {
  return new Date().toISOString();
}

function toEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    mode: row.mode as EpisodeMode,
    trigger: row.trigger,
    petId: row.pet_id,
    ...(row.ref === null ? {} : { ref: row.ref }),
    ...(row.conversation_id === null ? {} : { conversationId: row.conversation_id }),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.input === null ? {} : { input: row.input }),
    ...(row.decision === null ? {} : { decision: row.decision as EpisodeDecision }),
    ...(row.said === null ? {} : { said: row.said }),
    ...(row.note === null ? {} : { note: row.note }),
    ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
    ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
    ...(row.model_calls === null ? {} : { modelCalls: row.model_calls }),
    startedAt: row.started_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
  };
}

function toEvent(row: EventRow): EpisodeEvent {
  return {
    kind: row.kind as EpisodeEvent['kind'],
    name: row.name,
    ...(row.input === null ? {} : { input: row.input }),
    ...(row.result === null ? {} : { result: row.result }),
    ...(row.ok === null ? {} : { ok: row.ok === 1 }),
    at: row.at,
  };
}
