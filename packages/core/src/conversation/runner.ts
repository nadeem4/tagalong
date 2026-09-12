import { randomUUID } from 'node:crypto';
import type { ContextSnapshot, NotificationParamsOf, Pet, Settings } from '@tagalong/protocol';
import type { BrainProvider, BrainResult } from '../providers';
import { BrainError } from '../providers';
import type { ConversationStore } from '../memory/store';
import type { SettingsStore } from '../settings/settings';
import type { PerceptionToolset } from '../perception';
import { mayPersistScreenshot } from '../perception';
import { assemblePrompt } from './prompt-assembler';

/**
 * What the engine forwards to hosts. Shaped like the JSON-RPC notifications it becomes,
 * so the server layer can pass `params` straight through without a translation table.
 */
export type TurnEvent =
  | { method: 'turn.started'; params: NotificationParamsOf<'turn.started'> }
  | { method: 'turn.delta'; params: NotificationParamsOf<'turn.delta'> }
  | { method: 'turn.completed'; params: NotificationParamsOf<'turn.completed'> }
  | { method: 'turn.warning'; params: NotificationParamsOf<'turn.warning'> }
  | { method: 'turn.error'; params: NotificationParamsOf<'turn.error'> };

/** Injected rather than inherited from an EventEmitter: one sink, no subscription bookkeeping. */
export type TurnEventSink = (event: TurnEvent) => void;

export interface ConversationRunnerOptions {
  store: ConversationStore;
  /** Read per turn, so changing the history window takes effect without a restart. */
  settings: SettingsStore;
  provider: BrainProvider;
  emit: TurnEventSink;
  /**
   * The built-in perception tools. Optional because the runner has to work before any
   * host is connected — and because the tests that are about turn mechanics, not sight,
   * should not have to stand up a host to run.
   */
  tools?: PerceptionToolset | undefined;
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

/**
 * Answered when a model calls a tool it was never offered — a provider that hallucinates
 * one, or a turn running before any host connected. Honest beats silent: an empty result
 * teaches the model the tool worked and returned nothing.
 */
const NO_TOOLS_YET = 'No tools are available yet. Answer from the context you already have.';

/** Code on the warning a host shows when the pet's brain cannot read the picture it was given. */
export const VISION_UNSUPPORTED = 'vision_unsupported';

/**
 * The snapshot minus its pixels.
 *
 * Rebuilt by destructuring rather than by assigning `undefined`, because
 * `exactOptionalPropertyTypes` treats a present-but-undefined `screenshot` as a different
 * thing from an absent one — and so does `JSON.stringify`, which is what reaches the row.
 */
function withoutScreenshot(snapshot: ContextSnapshot): ContextSnapshot {
  const { screenshot: _dropped, ...rest } = snapshot;
  return rest;
}

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

    // Swept here rather than on a timer: a turn is the only moment this engine reliably
    // wakes up, and Phase 4 owns background jobs. It also catches the case a timer would
    // miss entirely — the user turning retention off and expecting the past to go with it.
    this.#options.store.purgeExpiredScreenshots(settings.screenshotRetention);

    // A screenshot is the most sensitive thing this app touches, so the row on disk gets
    // one only when the user has opted into a retention window. The turn itself still
    // sees the original: the promise is about the database, not about the pet's eyes.
    const stored =
      ask.snapshot && !mayPersistScreenshot(ask.snapshot, settings.screenshotRetention)
        ? withoutScreenshot(ask.snapshot)
        : ask.snapshot;

    this.#options.store.appendMessage({
      conversationId,
      role: 'user',
      content: [{ type: 'text', text: ask.text }],
      ...(stored ? { snapshot: stored } : {}),
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

    // Sending pixels to a model that cannot decode them costs the user tokens and buys a
    // confident answer about an image nobody read. Dropping it silently would be worse
    // still, so the warning goes out — as a warning, because the turn still answers.
    let snapshot = ask.snapshot;
    if (snapshot?.screenshot && !this.#options.provider.capabilities.vision) {
      snapshot = withoutScreenshot(snapshot);
      this.#options.emit({
        method: 'turn.warning',
        params: {
          turnId,
          code: VISION_UNSUPPORTED,
          message: `${ask.pet.name} cannot see images, so the screenshot was not sent.`,
        },
      });
    }

    const base = assemblePrompt({
      pet: ask.pet,
      history,
      settings,
      ...(snapshot ? { snapshot } : {}),
    });

    // A provider without tool support is never sent tools: some reject the field outright,
    // and the rest would only be told about an ability they cannot use.
    const tools = this.#options.provider.capabilities.tools ? this.#options.tools : undefined;
    const request = tools ? { ...base, tools: [...tools.definitions] } : base;

    try {
      const result = await this.#options.provider.complete(
        request,
        {
          onText: (text) => this.#options.emit({ method: 'turn.delta', params: { turnId, text } }),
          onToolUse: (call) =>
            tools ? tools.run(call) : Promise.resolve({ content: NO_TOOLS_YET, isError: true }),
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
