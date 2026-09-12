import { randomUUID } from 'node:crypto';
import type { ContextSnapshot, NotificationParamsOf, Pet, Settings } from '@tagalong/protocol';
import type { BrainProvider, BrainResult } from '../providers';
import { BrainError } from '../providers';
import type { ConversationStore } from '../memory/store';
import type { SettingsStore } from '../settings/settings';
import { assemblePrompt } from './prompt-assembler';

/**
 * What the engine forwards to hosts. Shaped like the JSON-RPC notifications it becomes,
 * so the server layer can pass `params` straight through without a translation table.
 */
export type TurnEvent =
  | { method: 'turn.started'; params: NotificationParamsOf<'turn.started'> }
  | { method: 'turn.delta'; params: NotificationParamsOf<'turn.delta'> }
  | { method: 'turn.completed'; params: NotificationParamsOf<'turn.completed'> }
  | { method: 'turn.error'; params: NotificationParamsOf<'turn.error'> };

/** Injected rather than inherited from an EventEmitter: one sink, no subscription bookkeeping. */
export type TurnEventSink = (event: TurnEvent) => void;

export interface ConversationRunnerOptions {
  store: ConversationStore;
  /** Read per turn, so changing the history window takes effect without a restart. */
  settings: SettingsStore;
  provider: BrainProvider;
  emit: TurnEventSink;
}

export interface RunAsk {
  pet: Pet;
  text: string;
  /** Omitted for the first ask; the runner opens a conversation and reports its id. */
  conversationId?: string | undefined;
  snapshot?: ContextSnapshot | undefined;
}

export interface TurnOutcome {
  turnId: string;
  conversationId: string;
  text: string;
  /** `error` is the runner's own reason: the provider never returned a stop reason. */
  stopReason: BrainResult['stopReason'] | 'error';
  usage: { inputTokens: number; outputTokens: number };
  error?: { code: string; message: string };
}

export interface TurnHandle {
  turnId: string;
  conversationId: string;
  /** Settles when the turn is over. Never rejects — a failure is reported as turn.error. */
  done: Promise<TurnOutcome>;
}

interface ActiveTurn {
  petId: string;
  controller: AbortController;
}

/** Phase 5 gives pets real tools; until then a tool call is answered honestly. */
const NO_TOOLS_YET = 'No tools are available yet. Answer from the context you already have.';

/**
 * Drives one turn: store the question, assemble the prompt, stream the answer, store it.
 *
 * The runner owns the turn lifecycle so hosts never do: they send an ask, receive a
 * turn id, and watch events. Interruption lives here too, because the AbortController
 * is the only thing that can stop a stream already in flight.
 */
export class ConversationRunner {
  readonly #options: ConversationRunnerOptions;
  readonly #active = new Map<string, ActiveTurn>();

  constructor(options: ConversationRunnerOptions) {
    this.#options = options;
  }

  /**
   * Returns as soon as the turn is on record, so the host gets its turn id while the
   * model is still thinking. Everything after that arrives as events or through `done`.
   */
  run(ask: RunAsk): TurnHandle {
    // One turn per pet: a pet that is still answering the last question has been
    // overtaken by this one, and two streams into one panel read as nonsense.
    this.#interruptPet(ask.pet.id);

    const settings = this.#options.settings.get();
    const conversationId =
      ask.conversationId ?? this.#options.store.createConversation({ petId: ask.pet.id }).id;

    this.#options.store.appendMessage({
      conversationId,
      role: 'user',
      content: [{ type: 'text', text: ask.text }],
      ...(ask.snapshot ? { snapshot: ask.snapshot } : {}),
    });

    const turnId = randomUUID();
    const controller = new AbortController();
    this.#active.set(turnId, { petId: ask.pet.id, controller });
    this.#options.emit({
      method: 'turn.started',
      params: { turnId, petId: ask.pet.id, conversationId },
    });

    const done = this.#stream(ask, turnId, conversationId, settings, controller.signal).finally(
      () => {
        this.#active.delete(turnId);
      },
    );

    return { turnId, conversationId, done };
  }

  /** Aborts a running turn. False means it had already finished or never existed. */
  interrupt(turnId: string): boolean {
    const active = this.#active.get(turnId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  /**
   * Aborts every running turn and reports how many were stopped. Shutdown needs this:
   * a stream left in flight would keep writing to a database that is about to close.
   */
  interruptAll(): number {
    let stopped = 0;
    for (const turnId of [...this.#active.keys()]) {
      if (this.interrupt(turnId)) stopped += 1;
    }
    return stopped;
  }

  #interruptPet(petId: string): void {
    for (const [turnId, active] of this.#active) {
      if (active.petId === petId) this.interrupt(turnId);
    }
  }

  async #stream(
    ask: RunAsk,
    turnId: string,
    conversationId: string,
    settings: Settings,
    signal: AbortSignal,
  ): Promise<TurnOutcome> {
    // Read history after the question is stored so the prompt ends on what was asked.
    const history = this.#options.store.lastMessages(conversationId, settings.historyMessages);
    const request = assemblePrompt({
      pet: ask.pet,
      history,
      settings,
      ...(ask.snapshot ? { snapshot: ask.snapshot } : {}),
    });

    try {
      const result = await this.#options.provider.complete(
        request,
        {
          onText: (text) => this.#options.emit({ method: 'turn.delta', params: { turnId, text } }),
          onToolUse: () => Promise.resolve({ content: NO_TOOLS_YET, isError: true }),
        },
        signal,
      );

      // An interrupted turn can end with nothing said; an empty row would only ever
      // be replayed back to the model as an empty assistant message.
      if (result.text.length > 0) {
        this.#options.store.appendMessage({
          conversationId,
          role: 'assistant',
          content: [{ type: 'text', text: result.text }],
        });
      }

      this.#options.emit({
        method: 'turn.completed',
        params: {
          turnId,
          text: result.text,
          stopReason: result.stopReason,
          usage: result.usage,
        },
      });
      return { turnId, conversationId, ...result };
    } catch (error) {
      const code = error instanceof BrainError ? error.code : 'unknown';
      const message = error instanceof Error ? error.message : String(error);
      this.#options.emit({ method: 'turn.error', params: { turnId, code, message } });
      return {
        turnId,
        conversationId,
        text: '',
        stopReason: 'error',
        usage: { inputTokens: 0, outputTokens: 0 },
        error: { code, message },
      };
    }
  }
}
