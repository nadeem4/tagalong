import { randomUUID } from 'node:crypto';
import type { ContextSnapshot, NotificationParamsOf, Pet, Settings } from '@tagalong/protocol';
import type { BrainContentBlock, BrainProvider, BrainResult } from '../providers';
import { BrainError, modelForTurn } from '../providers';
import type { ConversationStore } from '../memory/store';
import type { MemoryStore } from '../memory/memories';
import { recall, statedPreference } from '../memory/recall';
import type { SettingsStore } from '../settings/settings';
import { hasPixels, mayPersistScreenshot, withoutPixels } from '../perception';
import {
  ToolRegistry,
  type PerceptionToolsOptions,
  type ToolFilter,
  type WatchToolDeps,
  type ExpertToolDeps,
  type ConnectorToolDeps,
  type RoutineTurnContext,
  type RoutineToolDeps,
  type DayToolDeps,
} from '../tools';
import { assemblePrompt } from './prompt-assembler';

/**
 * What the engine forwards to hosts. Shaped like the JSON-RPC notifications it becomes,
 * so the server layer can pass `params` straight through without a translation table.
 */
export type TurnEvent =
  | { method: 'turn.started'; params: NotificationParamsOf<'turn.started'> }
  | { method: 'turn.delta'; params: NotificationParamsOf<'turn.delta'> }
  | { method: 'turn.toolRequest'; params: NotificationParamsOf<'turn.toolRequest'> }
  | { method: 'turn.toolResult'; params: NotificationParamsOf<'turn.toolResult'> }
  | { method: 'turn.completed'; params: NotificationParamsOf<'turn.completed'> }
  | { method: 'turn.warning'; params: NotificationParamsOf<'turn.warning'> }
  | { method: 'turn.error'; params: NotificationParamsOf<'turn.error'> };

/** Injected rather than inherited from an EventEmitter: one sink, no subscription bookkeeping. */
export type TurnEventSink = (event: TurnEvent) => void;

/**
 * Finds the brain a pet names in `providerId`. Called once per turn, so a pet the user
 * just moved to another provider answers from it on the next ask. May throw a
 * `BrainError` — no key stored, an unknown id — which the turn reports as `turn.error`.
 */
export type ProviderResolver = (pet: Pet) => BrainProvider;

export interface ConversationRunnerOptions {
  store: ConversationStore;
  /** Read per turn, so changing the history window takes effect without a restart. */
  settings: SettingsStore;
  /** One provider for every pet, or a resolver that picks each pet's own. */
  provider: BrainProvider | ProviderResolver;
  emit: TurnEventSink;
  /**
   * Wires the perception and recall tools. Optional because the runner has to work before
   * any host is connected — and because the tests that are about turn mechanics, not
   * sight, should not have to stand up a host to run.
   */
  perception?: PerceptionToolsOptions | undefined;
  /**
   * Phase 4. The pet's memory: recalled into every prompt, written by the `remember`
   * tool and by preferences the user states. Optional so turn-mechanics tests stay small.
   */
  memory?: MemoryStore | undefined;
  /**
   * Called after a turn that answered, without being awaited: the background summary job
   * hangs off this, and nothing it does may slow the reply that just finished.
   */
  afterTurn?: ((turn: { pet: Pet; conversationId: string }) => void) | undefined;
  /** Phase 3B. Gives every pet `watch_for`, which starts a watch on its behalf. */
  watch?: WatchToolDeps | undefined;
  /** Gives a companion `hand_to_expert`, which briefs an expert and hands the work over. */
  experts?: ExpertToolDeps | undefined;
  /** The tools of the person's connected apps, for a role that lists `connections`. */
  connections?: ConnectorToolDeps | undefined;
  /** Gives a companion `create_routine` and `change_routine`, which show the routine card. */
  routines?: RoutineToolDeps | undefined;
  /** Gives a companion `recall_day`, the daily briefing over the records already kept. */
  day?: DayToolDeps | undefined;
  /** Narrows a pet's tools for a turn. Absent: every pet gets every tool. Phase 8 roles. */
  toolsFor?: ToolFilter | undefined;
}

export interface RunAsk {
  pet: Pet;
  text: string;
  /** Omitted for the first ask; the runner opens a conversation and reports its id. */
  conversationId?: string | undefined;
  snapshot?: ContextSnapshot | undefined;
  /**
   * A turn nobody is watching, such as a routine's: it does not stop the pet's turn in
   * progress, and a question the person asks does not stop it.
   */
  background?: boolean | undefined;
  /** Set when a routine started the turn; rides on `turn.started` and reaches the tools. */
  routine?: RoutineTurnContext | undefined;
  /** The question was spoken (Talk to Scout): the answer is shaped to be heard. */
  spoken?: boolean | undefined;
}

export interface TurnOutcome {
  turnId: string;
  conversationId: string;
  text: string;
  /** `error` is the runner's own reason: the provider never returned a stop reason. */
  stopReason: BrainResult['stopReason'] | 'error';
  usage: { inputTokens: number; outputTokens: number };
  /** Model calls the turn made: the first, and each tool round trip. */
  modelCalls?: number;
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
  background: boolean;
  /** Set once the stream starts; settles when the turn is over. */
  done?: Promise<TurnOutcome>;
}

/**
 * Answered when a model calls a tool on a turn that was offered none — a provider that
 * hallucinates one, or a turn running before any tool is wired up. A turn that has tools
 * refuses an unknown name through the registry instead. Honest beats silent: an empty
 * result teaches the model the tool worked and returned nothing.
 */
const NO_TOOLS_YET = 'No tools are available yet. Answer from the context you already have.';

/** Code on the warning a host shows when the pet's brain cannot read the picture it was given. */
export const VISION_UNSUPPORTED = 'vision_unsupported';

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
  readonly #tools: ToolRegistry;

  constructor(options: ConversationRunnerOptions) {
    this.#options = options;
    this.#tools = new ToolRegistry({
      perception: options.perception,
      memory: options.memory,
      watch: options.watch,
      experts: options.experts,
      connections: options.connections,
      routines: options.routines,
      day: options.day,
      toolsFor: options.toolsFor,
    });
  }

  /**
   * Returns as soon as the turn is on record, so the host gets its turn id while the
   * model is still thinking. Everything after that arrives as events or through `done`.
   */
  run(ask: RunAsk): TurnHandle {
    // One turn per pet: a pet that is still answering the last question has been
    // overtaken by this one, and two streams into one panel read as nonsense.
    if (ask.background !== true) this.#interruptPet(ask.pet.id);

    const settings = this.#options.settings.get();
    const conversationId =
      ask.conversationId ?? this.#options.store.createConversation({ petId: ask.pet.id }).id;

    // Swept here rather than on a timer: a turn is the only moment this engine reliably
    // wakes up, and Phase 4 owns background jobs. It also catches the case a timer would
    // miss entirely — the user turning retention off and expecting the past to go with it.
    this.#options.store.purgeExpiredScreenshots(settings.screenshotRetention);

    // A screenshot is the most sensitive thing this app touches, so the row on disk gets
    // one only when the user has opted into a retention window; an image dropped on Scout
    // follows the same rule. The turn itself still sees the original: the promise is about
    // the database, not about the pet's eyes.
    const stored =
      ask.snapshot && !mayPersistScreenshot(ask.snapshot, settings.screenshotRetention)
        ? withoutPixels(ask.snapshot)
        : ask.snapshot;

    this.#options.store.appendMessage({
      conversationId,
      role: 'user',
      content: [{ type: 'text', text: ask.text }],
      ...(stored ? { snapshot: stored } : {}),
    });

    // Filed before the turn runs, so even a turn that fails still keeps what was said.
    const preference = this.#options.memory ? statedPreference(ask.text) : null;
    if (preference !== null) {
      this.#options.memory?.addOnce({
        scope: 'pet',
        petId: ask.pet.id,
        kind: 'preference',
        text: preference,
      });
    }

    const turnId = randomUUID();
    const controller = new AbortController();
    this.#active.set(turnId, {
      petId: ask.pet.id,
      controller,
      background: ask.background === true,
    });
    this.#options.emit({
      method: 'turn.started',
      params: {
        turnId,
        petId: ask.pet.id,
        conversationId,
        providerId: ask.pet.providerId,
        model: ask.pet.model,
        ...(ask.routine === undefined ? {} : { routineId: ask.routine.routineId }),
      },
    });

    const done = this.#stream(ask, turnId, conversationId, settings, controller.signal).finally(
      () => {
        this.#active.delete(turnId);
      },
    );
    const active = this.#active.get(turnId);
    if (active !== undefined) active.done = done;

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

  /**
   * Aborts every running turn and waits until each has settled. An aborted stream still
   * writes its last row and event, so shutdown waits here before closing the database.
   */
  async stopAll(): Promise<void> {
    const running = [...this.#active.values()].flatMap((active) =>
      active.done === undefined ? [] : [active.done],
    );
    this.interruptAll();
    await Promise.allSettled(running);
  }

  #interruptPet(petId: string): void {
    for (const [turnId, active] of this.#active) {
      if (active.petId === petId && !active.background) this.interrupt(turnId);
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

    let provider: BrainProvider;
    try {
      const option = this.#options.provider;
      provider = typeof option === 'function' ? option(ask.pet) : option;
    } catch (error) {
      return this.#fail(turnId, conversationId, error);
    }

    // Whether any model this pet may use can decode an image. Sending pixels to one that
    // cannot costs the user tokens and buys a confident answer about an image nobody read.
    // Dropping it silently would be worse still, so the warning goes out — as a warning,
    // because the turn still answers.
    const canSee = modelForTurn(provider, ask.pet, true) !== null;

    let snapshot = ask.snapshot;
    if (snapshot !== undefined && hasPixels(snapshot) && !canSee) {
      const what = snapshot.screenshot !== undefined ? 'the screenshot was' : 'the image was';
      snapshot = withoutPixels(snapshot);
      this.#options.emit({
        method: 'turn.warning',
        params: {
          turnId,
          code: VISION_UNSUPPORTED,
          message: `${ask.pet.name} cannot see images, so ${what} not sent.`,
        },
      });
    }

    const memories = this.#options.memory
      ? recall(
          this.#options.memory,
          ask.pet.id,
          [ask.text, ask.snapshot?.selection ?? ''].join(' '),
        )
      : [];

    const base = assemblePrompt({
      pet: ask.pet,
      history,
      settings,
      memories,
      ...(snapshot ? { snapshot } : {}),
      spoken: ask.spoken,
    });

    // One for the first call; every tool round trip adds another.
    let modelCalls = 1;
    const tools = this.#tools.forTurn({
      pet: ask.pet,
      turnId,
      signal,
      snapshot,
      vision: canSee,
      // A provider without tool support is never sent tools: some reject the field
      // outright, and the rest would only be told about an ability they cannot use.
      toolSupport: provider.capabilities.tools,
      ...(ask.routine !== undefined ? { routine: ask.routine } : {}),
    });
    const request =
      tools.definitions.length > 0 ? { ...base, tools: [...tools.definitions] } : base;

    try {
      const result = await provider.complete(
        request,
        {
          onText: (text) => this.#options.emit({ method: 'turn.delta', params: { turnId, text } }),
          onToolUse: async (call) => {
            if (tools.definitions.length === 0) return { content: NO_TOOLS_YET, isError: true };
            modelCalls += 1;
            // Announced around the call, not after it. A tool that takes seconds —
            // enumerating windows walks an accessibility tree — leaves the user watching
            // a pet that looks hung, and a turn whose tool activity is never broadcast
            // cannot be observed end to end at all, which is how this phase shipped two
            // dead perception paths behind a green suite.
            this.#options.emit({
              method: 'turn.toolRequest',
              params: { turnId, approvalId: randomUUID(), tool: call.name, input: call.input },
            });
            const outcome = await tools.run(call);
            this.#options.emit({
              method: 'turn.toolResult',
              params: {
                turnId,
                tool: call.name,
                ok: outcome.isError !== true,
                // The summary is for the panel, not the model: the model already has the
                // content. Kept short so a 8,000-character window read does not travel
                // twice, once to the provider and once to every open window.
                summary: summarise(outcome.content),
              },
            });
            return outcome;
          },
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
          modelCalls,
        },
      });
      if (result.text.length > 0) {
        this.#options.afterTurn?.({ pet: ask.pet, conversationId });
      }
      return { turnId, conversationId, ...result, modelCalls };
    } catch (error) {
      return this.#fail(turnId, conversationId, error);
    }
  }

  #fail(turnId: string, conversationId: string, error: unknown): TurnOutcome {
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

/**
 * A one-line gist of a tool result, for the panel.
 *
 * Blocks become a count of what came back rather than the pixels themselves: a base64
 * screenshot forwarded to every open window would be megabytes of IPC to render one line
 * of chrome, and the model already has the image.
 */
function summarise(content: string | BrainContentBlock[]): string {
  if (typeof content !== 'string') {
    const images = content.filter((block) => block.type === 'image').length;
    return images > 0 ? `${images} image${images === 1 ? '' : 's'}` : 'no content';
  }
  const firstLine = content.split('\n', 1)[0] ?? '';
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}
