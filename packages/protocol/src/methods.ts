import { z } from 'zod';
import {
  CapturedImage,
  ContextSnapshot,
  ContextSnapshotPatch,
  DisplayBounds,
  HostKind,
  PerceptionTarget,
  WindowEntry,
} from './context';
import {
  PerceptionDiffParams,
  PerceptionDiffResult,
  PerceptionRecallParams,
  PerceptionRecallResult,
  WatchFiredParams,
  WatchStatusParams,
  WatchStopParams,
  WatchStopResult,
} from './awareness';
import { DEFAULT_WINDOW_TEXT_CHARS, MAX_WINDOW_TEXT_CHARS } from './limits';
import { Pet } from './pet';
import { CaptureBlock, Settings, SettingsPatch } from './settings';

/** What a host tells the engine it is able to perceive or play. */
export const HostCapability = z.enum([
  'selection',
  'screenshot',
  'activeWindow',
  'clipboard',
  'pageText',
  'audioIn',
  'audioOut',
  /** Phase 2B: can enumerate and photograph every display, not only the focused one. */
  'displays',
  /** Phase 2B: can read a window's text without photographing it. */
  'textLayer',
  /** Phase 3B: answers perception.recall and perception.diff from its in-memory frames. */
  'recall',
]);
export type HostCapability = z.infer<typeof HostCapability>;

const Empty = z.object({});

export { DEFAULT_WINDOW_TEXT_CHARS, MAX_WINDOW_TEXT_CHARS } from './limits';

// ---------------------------------------------------------------------------
// Host to core
// ---------------------------------------------------------------------------

export const HelloParams = z.object({
  host: HostKind,
  version: z.string().min(1),
  capabilities: z.array(HostCapability),
  /** Read from dataDir/pairing.token. Without it the engine closes the socket. */
  token: z.string().min(1),
});
export const HelloResult = z.object({
  sessionId: z.uuid(),
  engineVersion: z.string(),
  protocolVersion: z.string(),
  pets: z.array(Pet),
});

export const AskInput = z
  .object({
    text: z.string().optional(),
    /** Phase 3: push-to-talk audio, transcribed by the engine. */
    audio: z.object({ mime: z.string().min(1), base64: z.string().min(1) }).optional(),
  })
  .refine((i) => i.text !== undefined || i.audio !== undefined, {
    message: 'an ask needs text or audio',
  });

export const AskParams = z.object({
  petId: z.string().min(1),
  conversationId: z.uuid().optional(),
  input: AskInput,
  snapshot: ContextSnapshot.optional(),
});
/** Progress arrives as turn.* notifications, not in this result. */
export const AskResult = z.object({ turnId: z.uuid() });

export const InterruptParams = z.object({ turnId: z.uuid() });
export const InterruptResult = z.object({ aborted: z.boolean() });

export const PetsListParams = Empty;
export const PetsListResult = z.object({ pets: z.array(Pet) });

export const PetsUpsertParams = z.object({ pet: Pet });
export const PetsUpsertResult = z.object({ pet: Pet });

export const PetsDeleteParams = z.object({ petId: z.string().min(1) });
export const PetsDeleteResult = z.object({ deleted: z.boolean() });

export const SettingsGetParams = Empty;
export const SettingsGetResult = z.object({ settings: Settings });

export const SettingsSetParams = z.object({ patch: SettingsPatch });
export const SettingsSetResult = z.object({ settings: Settings });

/**
 * The models a provider offers, for the Settings model picker.
 *
 * `source` says whether the list came from the service itself (`GET /models`) or is the
 * engine's built-in fallback — no key stored, offline, or a service that refused — so
 * a host can say "showing the built-in list" instead of passing a guess off as live.
 */
export const ModelsListParams = z.object({ providerId: z.string().min(1) });
export const ModelsListResult = z.object({
  models: z.array(z.string().min(1)),
  source: z.enum(['live', 'fallback']),
});

/** Phase 5. Present from Phase 1 so the catalog matches the documented table. */
export const ToolApproveParams = z.object({
  approvalId: z.uuid(),
  decision: z.enum(['once', 'always', 'deny']),
});
export const ToolApproveResult = z.object({ accepted: z.boolean() });

// ---------------------------------------------------------------------------
// Core to host
// ---------------------------------------------------------------------------

/** Lets a pet look on demand mid-turn. */
export const PerceptionCaptureParams = z.object({ what: z.array(PerceptionTarget).min(1) });
export const PerceptionCaptureResult = z.object({ snapshot: ContextSnapshotPatch });

/**
 * Phase 2B. A native-resolution crop of one display, for when the composite is too coarse.
 *
 * The composite gives each monitor a few hundred pixels — enough to see that a terminal is
 * red, not enough to read it. This is the lean-in: the pet names a rectangle and gets it at
 * a useful size, the way a person walks closer to a screen.
 */
export const PerceptionCaptureRegionParams = z.object({
  displayId: z.number().int(),
  /** In that display's own pixels. The origin may be negative, as display bounds are. */
  rect: DisplayBounds,
  maxLongSide: z.number().int().positive(),
});
export const PerceptionCaptureRegionResult = z.object({ image: CapturedImage });

/** Phase 2B. Every top-level window: what and where, never what is inside. */
export const PerceptionListWindowsParams = Empty;
export const PerceptionListWindowsResult = z.object({ windows: z.array(WindowEntry) });

/**
 * Phase 2B. The text of exactly one window.
 *
 * There is deliberately no scope that reads everything. Measured on a twelve-window
 * desktop, the whole text layer is 46,491 characters — roughly 11,600 tokens — in a single
 * call, and one background browser window supplied 34,588 of them. The pet reads the
 * inventory, which is about 200 tokens, picks a window, and pays for that one.
 */
export const PerceptionReadTextParams = z.object({
  /** Omit for the foreground window. A window behind another or minimized reads fine. */
  windowId: z.string().min(1).optional(),
  maxChars: z
    .number()
    .int()
    .positive()
    .max(MAX_WINDOW_TEXT_CHARS)
    .default(DEFAULT_WINDOW_TEXT_CHARS),
});
export const PerceptionReadTextResult = z.object({
  /** Which window answered, so a `focusedWindow` read can be attributed. */
  windowId: z.string().min(1),
  text: z.string(),
  /** True when the text is a prefix, so the pet does not read a cut-off line as the end. */
  truncated: z.boolean(),
  /** `ocr` text may contain recognition errors and the pet is told so. */
  source: z.enum(['uia', 'ocr']),
  /** Present when an exclusion refused this window. `text` is then empty. */
  blocked: CaptureBlock.optional(),
  /**
   * What the text does not say, in plain sentences the pet can repeat.
   *
   * An accessibility tree carries what an application chooses to publish. Editors,
   * terminals and canvas apps draw their own glyphs and publish only menus and tab
   * titles, so a read of one returns a few hundred characters that look like a complete
   * answer and are not. Measured on a live desktop: a minimized editor returned 456
   * characters, all of it window chrome, none of it the open file.
   *
   * A separate field rather than a prefix on `text`, so a pet cannot quote a caveat back
   * as though it were something on the user's screen. Attached where the read happens
   * rather than left to whatever surfaces the result later: a qualification that depends
   * on a later consumer remembering it is a qualification that goes missing.
   */
  notes: z.array(z.string().min(1)).optional(),
});
export type PerceptionReadTextParams = z.infer<typeof PerceptionReadTextParams>;
export type PerceptionReadTextResult = z.infer<typeof PerceptionReadTextResult>;
export type PerceptionListWindowsResult = z.infer<typeof PerceptionListWindowsResult>;
export type PerceptionCaptureRegionResult = z.infer<typeof PerceptionCaptureRegionResult>;
export type PerceptionCaptureRegionParams = z.infer<typeof PerceptionCaptureRegionParams>;

// ---------------------------------------------------------------------------
// Core to host notifications (no result; the host must not answer)
// ---------------------------------------------------------------------------

export const TurnStartedParams = z.object({
  turnId: z.uuid(),
  petId: z.string().min(1),
  conversationId: z.uuid(),
  /**
   * Phase 4. The brain answering, so a panel can say which pet and which model said what —
   * a crew spans providers, and "Ink · anthropic/claude-sonnet-5" is the point of showing it.
   */
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /** Phase 4. Set when the turn is part of a crew run — a roundtable, or a handoff. */
  runId: z.uuid().optional(),
});
export const TurnDeltaParams = z.object({ turnId: z.uuid(), text: z.string() });
/** Phase 3. index orders chunks so the host can play them without gaps. */
export const TurnAudioParams = z.object({
  turnId: z.uuid(),
  index: z.number().int().nonnegative(),
  mime: z.string().min(1),
  base64: z.string().min(1),
});
/** Phase 5. */
export const TurnToolRequestParams = z.object({
  turnId: z.uuid(),
  approvalId: z.uuid(),
  tool: z.string().min(1),
  input: z.unknown(),
});
export const TurnToolResultParams = z.object({
  turnId: z.uuid(),
  tool: z.string().min(1),
  ok: z.boolean(),
  summary: z.string(),
});
export const TurnCompletedParams = z.object({
  turnId: z.uuid(),
  text: z.string(),
  stopReason: z.enum(['end', 'max_tokens', 'aborted', 'refusal']),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  /**
   * Phase 4. How many model calls this turn made, counting tool round trips and any pet it
   * consulted. Crew features multiply calls; the panel footer adds these up.
   */
  modelCalls: z.number().int().nonnegative().optional(),
});
export const TurnErrorParams = z.object({
  turnId: z.uuid(),
  code: z.string().min(1),
  message: z.string(),
});
/**
 * Something the user must know about a turn that is still going to answer.
 *
 * Separate from `turn.error` on purpose: an error ends the turn, and a host that aborts
 * on one would wrongly throw away a perfectly good reply. Shaped like `turn.error` so a
 * host can render both with the same code, only in a quieter colour.
 */
export const TurnWarningParams = z.object({
  turnId: z.uuid(),
  /** Machine-readable so a host can decide what to show; `vision_unsupported` is the first. */
  code: z.string().min(1),
  message: z.string(),
});
/**
 * Phase 4. One pet addressing another, shown as a bubble or a card.
 *
 * `handoff`: `text` is the summary the target received; `turnId` and `conversationId` are
 * the target's new turn and conversation. `consult`: `text` is the question; `turnId` is
 * the caller's turn. `roundtable`: `text` names the round; `toPetId` is who speaks next.
 */
export const PetMessageParams = z.object({
  fromPetId: z.string().min(1),
  toPetId: z.string().min(1),
  kind: z.enum(['handoff', 'consult', 'roundtable']),
  text: z.string(),
  turnId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  runId: z.uuid().optional(),
  round: z.number().int().positive().optional(),
});

/**
 * Phase 4. Progress of a crew run, so a host can show it is still going, offer to stop it,
 * and count what it cost. `round` and `rounds` count the synthesis as the last round.
 */
export const CrewStatusParams = z.object({
  runId: z.uuid(),
  kind: z.enum(['roundtable']),
  state: z.enum(['running', 'done', 'stopped']),
  round: z.number().int().nonnegative(),
  rounds: z.number().int().positive(),
  modelCalls: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

interface MethodSpec {
  readonly params: z.ZodType;
  readonly result: z.ZodType;
}
interface NotificationSpec {
  readonly params: z.ZodType;
}

export const hostToCoreMethods = {
  hello: { params: HelloParams, result: HelloResult },
  ask: { params: AskParams, result: AskResult },
  interrupt: { params: InterruptParams, result: InterruptResult },
  'pets.list': { params: PetsListParams, result: PetsListResult },
  'pets.upsert': { params: PetsUpsertParams, result: PetsUpsertResult },
  'pets.delete': { params: PetsDeleteParams, result: PetsDeleteResult },
  'settings.get': { params: SettingsGetParams, result: SettingsGetResult },
  'settings.set': { params: SettingsSetParams, result: SettingsSetResult },
  'models.list': { params: ModelsListParams, result: ModelsListResult },
  'tool.approve': { params: ToolApproveParams, result: ToolApproveResult },
  'watch.stop': { params: WatchStopParams, result: WatchStopResult },
} as const satisfies Record<string, MethodSpec>;

export const coreToHostMethods = {
  'perception.capture': { params: PerceptionCaptureParams, result: PerceptionCaptureResult },
  'perception.captureRegion': {
    params: PerceptionCaptureRegionParams,
    result: PerceptionCaptureRegionResult,
  },
  'perception.listWindows': {
    params: PerceptionListWindowsParams,
    result: PerceptionListWindowsResult,
  },
  'perception.readText': { params: PerceptionReadTextParams, result: PerceptionReadTextResult },
  'perception.recall': { params: PerceptionRecallParams, result: PerceptionRecallResult },
  'perception.diff': { params: PerceptionDiffParams, result: PerceptionDiffResult },
} as const satisfies Record<string, MethodSpec>;

export const coreToHostNotifications = {
  'turn.started': { params: TurnStartedParams },
  'turn.delta': { params: TurnDeltaParams },
  'turn.audio': { params: TurnAudioParams },
  'turn.toolRequest': { params: TurnToolRequestParams },
  'turn.toolResult': { params: TurnToolResultParams },
  'turn.completed': { params: TurnCompletedParams },
  'turn.error': { params: TurnErrorParams },
  'turn.warning': { params: TurnWarningParams },
  'pet.message': { params: PetMessageParams },
  'crew.status': { params: CrewStatusParams },
  'watch.fired': { params: WatchFiredParams },
  'watch.status': { params: WatchStatusParams },
} as const satisfies Record<string, NotificationSpec>;

export type HostToCoreMethod = keyof typeof hostToCoreMethods;
export type CoreToHostMethod = keyof typeof coreToHostMethods;
export type CoreToHostNotification = keyof typeof coreToHostNotifications;

export type ParamsOf<M extends HostToCoreMethod> = z.infer<(typeof hostToCoreMethods)[M]['params']>;
export type ResultOf<M extends HostToCoreMethod> = z.infer<(typeof hostToCoreMethods)[M]['result']>;
export type NotificationParamsOf<N extends CoreToHostNotification> = z.infer<
  (typeof coreToHostNotifications)[N]['params']
>;

/**
 * Schema lookups that only accept catalogued method names. Passing an unknown
 * name is a compile error, which is what keeps the two sides of the socket honest.
 */
export function paramsSchemaFor<M extends HostToCoreMethod>(
  method: M,
): (typeof hostToCoreMethods)[M]['params'] {
  return hostToCoreMethods[method].params;
}

export function resultSchemaFor<M extends HostToCoreMethod>(
  method: M,
): (typeof hostToCoreMethods)[M]['result'] {
  return hostToCoreMethods[method].result;
}

export function notificationParamsSchemaFor<N extends CoreToHostNotification>(
  notification: N,
): (typeof coreToHostNotifications)[N]['params'] {
  return coreToHostNotifications[notification].params;
}
