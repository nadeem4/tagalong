import { z } from 'zod';
import { ContextSnapshot, ContextSnapshotPatch, HostKind, PerceptionTarget } from './context';
import { Pet } from './pet';
import { Settings, SettingsPatch } from './settings';

/** What a host tells the engine it is able to perceive or play. */
export const HostCapability = z.enum([
  'selection',
  'screenshot',
  'activeWindow',
  'clipboard',
  'pageText',
  'audioIn',
  'audioOut',
]);
export type HostCapability = z.infer<typeof HostCapability>;

const Empty = z.object({});

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

// ---------------------------------------------------------------------------
// Core to host notifications (no result; the host must not answer)
// ---------------------------------------------------------------------------

export const TurnStartedParams = z.object({
  turnId: z.uuid(),
  petId: z.string().min(1),
  conversationId: z.uuid(),
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
/** Phase 4. */
export const PetMessageParams = z.object({
  fromPetId: z.string().min(1),
  toPetId: z.string().min(1),
  kind: z.enum(['handoff', 'consult', 'roundtable']),
  text: z.string(),
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
  'tool.approve': { params: ToolApproveParams, result: ToolApproveResult },
} as const satisfies Record<string, MethodSpec>;

export const coreToHostMethods = {
  'perception.capture': { params: PerceptionCaptureParams, result: PerceptionCaptureResult },
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
