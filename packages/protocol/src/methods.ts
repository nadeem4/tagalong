/**
 * The JSON-RPC method catalog: every request and notification between the engine and a
 * host, with its params and result schemas. Contains the remaining message schemas,
 * HostCapability, the three catalog objects (hostToCoreMethods, coreToHostMethods,
 * coreToHostNotifications) and typed lookups. After `hello`, the extension may call only
 * `ask`, `interrupt` and `pets.list` (core's EXTENSION_METHODS); every other host-to-core
 * method is desktop-only.
 */
import { z } from 'zod';
import { ActivityListParams, ActivityListResult } from './activity';
import { UsageSummaryParams, UsageSummaryResult } from './usage';
import {
  ConnectionsAddParams,
  ConnectionsAddResult,
  ConnectionsChangedParams,
  ConnectionsListParams,
  ConnectionsListResult,
  ConnectionsRemoveParams,
  ConnectionsRemoveResult,
  ConnectionsSetEnabledParams,
  ConnectionsSetEnabledResult,
  ConnectionsSignInParams,
  ConnectionsSignInResult,
  ConnectorConfirmParams,
} from './connections';
import {
  ExpertsCatalogParams,
  ExpertsCatalogResult,
  ExpertsDeleteParams,
  ExpertsDeleteResult,
  ExpertsListParams,
  ExpertsInstallParams,
  ExpertsInstallResult,
  ExpertsListResult,
  ExpertsTestParams,
  ExpertsTestResult,
  ExpertsUpsertParams,
  ExpertsUpsertResult,
  HandoffFinishedParams,
  HandoffProgressParams,
  HandoffsCancelParams,
  HandoffsCancelResult,
  HandoffProposedParams,
  HandoffsConfirmParams,
  HandoffsConfirmResult,
  HandoffsDismissParams,
  HandoffsDismissResult,
  ProjectsSearchParams,
  ProjectsSearchResult,
} from './experts';
import {
  CapturedImage,
  ContextSnapshot,
  ContextSnapshotPatch,
  DisplayBounds,
  HostKind,
  PerceptionTarget,
  ScreenInfo,
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
import {
  RoutineProposedParams,
  RoutineResultParams,
  RoutinesChangedParams,
  RoutinesConfirmParams,
  RoutinesConfirmResult,
  RoutinesDeleteParams,
  RoutinesDeleteResult,
  RoutinesDismissParams,
  RoutinesDismissResult,
  RoutinesListParams,
  RoutinesListResult,
  RoutinesRunNowParams,
  RoutinesRunNowResult,
  RoutinesSaveParams,
  RoutinesSaveResult,
  RoutinesSetEnabledParams,
  RoutinesSetEnabledResult,
  CalendarCheckParams,
  CalendarCheckResult,
  CalendarSetLinkParams,
  CalendarSetLinkResult,
} from './routines';
import { DEFAULT_WINDOW_TEXT_CHARS, MAX_WINDOW_TEXT_CHARS } from './limits';
import {
  PickUpDismissParams,
  PickUpDismissResult,
  PickUpReadyParams,
  PickUpRebriefParams,
  PickUpRebriefResult,
} from './pick-up';
import { Pet } from './pet';
import { CaptureBlock, Settings, SettingsPatch, SettingsProposedParams } from './settings';
import {
  SightLogClearParams,
  SightLogClearResult,
  SightLogDeleteParams,
  SightLogDeleteResult,
  SightLogListParams,
  SightLogListResult,
} from './sight-log';
import {
  MemoryDeleteParams,
  MemoryDeleteResult,
  MemoryListParams,
  MemoryListResult,
} from './memory';

/** What a host tells the engine it is able to perceive or play. */
export const HostCapability = z.enum([
  'selection',
  'screenshot',
  'activeWindow',
  'clipboard',
  'pageText',
  /** Can enumerate and photograph every display, not only the focused one. */
  'displays',
  /** Can read a window's text without photographing it. */
  'textLayer',
  /** Answers perception.recall and perception.diff from its in-memory frames. */
  'recall',
  /** Draws a ring around one thing on screen (screen.pointAt). Never moves the mouse. */
  'pointer',
]);
export type HostCapability = z.infer<typeof HostCapability>;

const Empty = z.object({});

export { DEFAULT_WINDOW_TEXT_CHARS, MAX_WINDOW_TEXT_CHARS } from './limits';

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

/** What the person asked. Speech becomes text on the host before an ask is sent. */
export const AskInput = z.object({ text: z.string() });

export const AskParams = z.object({
  petId: z.string().min(1),
  conversationId: z.uuid().optional(),
  input: AskInput,
  snapshot: ContextSnapshot.optional(),
  /** The question was spoken (Talk to Scout): Scout answers the way a person talks. */
  spoken: z.boolean().optional(),
});
/** Progress arrives as turn.* notifications, not in this result. */
export const AskResult = z.object({ turnId: z.uuid() });

export const InterruptParams = z.object({ turnId: z.uuid() });
export const InterruptResult = z.object({ aborted: z.boolean() });

export const PetsListParams = Empty;
export const PetsListResult = z.object({ pets: z.array(Pet) });

export const PetsUpsertParams = z.object({ pet: Pet });
export const PetsUpsertResult = z.object({ pet: Pet });

export const SettingsGetParams = Empty;
export const SettingsGetResult = z.object({ settings: Settings });

export const SettingsSetParams = z.object({
  patch: SettingsPatch,
  /**
   * Set when the person clicked Apply on a card Scout showed (change settings by talking):
   * the engine writes a "Changed by talk" row in the log of what Scout saw.
   */
  byTalk: z.boolean().optional(),
});
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

/** Setup's one test of a pasted key: a tiny real request, then ok or a plain reason. */
export const ProvidersCheckParams = z.object({ providerId: z.string().min(1) });
export const ProvidersCheckResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), message: z.string().min(1) }),
]);
export type ProvidersCheckResult = z.infer<typeof ProvidersCheckResult>;

/** The person's answer to `connector.confirm`. `once` runs that one change; `deny` cancels it. */
export const ToolApproveParams = z.object({
  approvalId: z.uuid(),
  decision: z.enum(['once', 'deny']),
});
export const ToolApproveResult = z.object({ accepted: z.boolean() });

/** Lets a pet look on demand mid-turn. */
export const PerceptionCaptureParams = z.object({ what: z.array(PerceptionTarget).min(1) });
export const PerceptionCaptureResult = z.object({ snapshot: ContextSnapshotPatch });

/**
 * A native-resolution crop of one display, for when the composite is too coarse.
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

/**
 * A screenshot of one listed window, in front or behind others. A minimized window has
 * nothing drawn, and a blind spot is refused: both come back without an image, with notes
 * saying why, so the pet can repeat the reason instead of guessing.
 */
export const PerceptionCaptureWindowParams = z.object({
  windowId: z.string().min(1),
  maxLongSide: z.number().int().positive(),
});
export const PerceptionCaptureWindowResult = z.object({
  windowId: z.string().min(1),
  image: CapturedImage.optional(),
  blocked: CaptureBlock.optional(),
  notes: z.array(z.string()).optional(),
});

/** Every top-level window: what and where, never what is inside. */
export const PerceptionListWindowsParams = Empty;
export const PerceptionListWindowsResult = z.object({
  windows: z.array(WindowEntry),
  /** Every screen, in the order the composite numbers them. Absent from older hosts. */
  displays: z.array(ScreenInfo).optional(),
});

/**
 * The text of exactly one window. There is no scope that reads everything: on a
 * twelve-window desktop that was about 11,600 tokens in one call, while the inventory
 * costs about 200.
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
   * What the text does not say, in sentences the pet can repeat: editors, terminals and
   * canvas apps publish little to the accessibility tree, so a short read can look complete
   * when it is not. A separate field, so the pet never quotes a caveat as screen content.
   */
  notes: z.array(z.string().min(1)).optional(),
});
export type PerceptionReadTextParams = z.infer<typeof PerceptionReadTextParams>;
export type PerceptionReadTextResult = z.infer<typeof PerceptionReadTextResult>;
export type PerceptionListWindowsResult = z.infer<typeof PerceptionListWindowsResult>;
export type PerceptionCaptureRegionResult = z.infer<typeof PerceptionCaptureRegionResult>;
export type PerceptionCaptureRegionParams = z.infer<typeof PerceptionCaptureRegionParams>;

/** The longest label the ring shows beside what it points at. */
export const POINT_LABEL_MAX = 40;

/**
 * Point, don't click: a ring around one thing on screen, drawn by the host. Nothing is moved,
 * clicked or typed. Either an element named inside one listed window (preferred: the host
 * finds it by its accessibility name), or a rectangle of one display in that display's own
 * pixels, as look_closer takes, for something only a picture shows.
 */
export const ScreenPointAtParams = z.union([
  z.strictObject({
    windowId: z.string().min(1),
    name: z.string().min(1).max(200),
    label: z.string().max(POINT_LABEL_MAX).optional(),
  }),
  z.strictObject({
    displayId: z.number().int(),
    rect: DisplayBounds,
    label: z.string().max(POINT_LABEL_MAX).optional(),
  }),
]);
/** Shown, on which screen (numbered as the window list numbers them), or why not. */
export const ScreenPointAtResult = z.object({
  shown: z.boolean(),
  screen: z.number().int().positive().optional(),
  /** Present when an exclusion refused the window: nothing in it was read. */
  blocked: CaptureBlock.optional(),
  /** Why nothing was shown, in sentences the pet can repeat. */
  notes: z.array(z.string().min(1)).optional(),
});
export type ScreenPointAtParams = z.infer<typeof ScreenPointAtParams>;
export type ScreenPointAtResult = z.infer<typeof ScreenPointAtResult>;
export type PerceptionCaptureWindowParams = z.infer<typeof PerceptionCaptureWindowParams>;
export type PerceptionCaptureWindowResult = z.infer<typeof PerceptionCaptureWindowResult>;

export const TurnStartedParams = z.object({
  turnId: z.uuid(),
  petId: z.string().min(1),
  conversationId: z.uuid(),
  /** The brain answering, so a panel can say which model said what: "Scout · haiku". */
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /** Set when a routine started the turn: no bubble takes it for the person's own question. */
  routineId: z.uuid().optional(),
});
export const TurnDeltaParams = z.object({ turnId: z.uuid(), text: z.string() });
/** A pet's tool call is starting; `turn.toolResult` follows when it ends. */
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
  /** `refusal` and `tool_limit` come with empty text: the UI shows a quiet status instead. */
  stopReason: z.enum(['end', 'max_tokens', 'aborted', 'refusal', 'tool_limit']),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  /** How many model calls this turn made, counting tool round trips. */
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
  /** Machine-readable, such as `vision_unsupported`, so a host can decide what to show. */
  code: z.string().min(1),
  message: z.string(),
});
/** What the host recorded about the last launch, for the line said as this one opens. */
export const GreetingLaunch = z.object({
  /** The last launch never recorded a clean close. */
  crashed: z.boolean(),
  /** The version the last launch ran; null when none was recorded. */
  lastVersion: z.string().min(1).nullable(),
  /** The version running now. */
  version: z.string().min(1),
  /** One line on what is new in this version; empty when there is nothing to say. */
  whatsNew: z.string(),
});
export type GreetingLaunch = z.infer<typeof GreetingLaunch>;
/**
 * The line a pet says when the app opens, after the first time. `model` when the summaries
 * model wrote it, `fallback` when a handwritten line stood in. It reads no screen.
 */
export const GreetingComposeParams = z.object({
  petId: z.string().min(1),
  launch: GreetingLaunch.optional(),
});
export const GreetingComposeResult = z.object({
  text: z.string().min(1),
  source: z.enum(['model', 'fallback']),
  /** Set when the line is a pick-up: what the card lists, for Pick up on the line. */
  pickUp: PickUpReadyParams.optional(),
});
export type GreetingComposeResult = z.infer<typeof GreetingComposeResult>;

/**
 * Keep an eye on things. The host sends what is open, titles only, every few seconds; the
 * engine decides whether one window is worth a look. Most snapshots end there.
 */
export const KeepAnEyeObserveParams = z.object({ windows: z.array(WindowEntry) });
export const KeepAnEyeObserveResult = Empty;
/** "Not now" on a remark: quiet for an hour. */
export const KeepAnEyeNotNowParams = Empty;
export const KeepAnEyeNotNowResult = z.object({ quietUntil: z.iso.datetime() });
/** The person took a remark's offer: its brief goes to the hand-off card, unsent. */
export const KeepAnEyeAcceptParams = z.object({ remarkId: z.uuid() });
export const KeepAnEyeAcceptResult = z.object({ proposed: z.boolean() });

/**
 * One short line a pet says on its own, from a window it kept an eye on. `offer` is a task
 * an expert could take, shown as a button that opens the hand-off card; nothing is sent
 * until the person presses Send there.
 */
export const PetRemarkParams = z.object({
  remarkId: z.uuid(),
  petId: z.string().min(1),
  text: z.string().min(1),
  offer: z.string().min(1).optional(),
});
export type PetRemarkParams = z.infer<typeof PetRemarkParams>;

/**
 * A short reaction on the pet's face, with no words: a wince at a failing build or an
 * expert's error, a cheer when tests pass. The host clears those after a few seconds.
 * `tired` (a long stretch, or late at night) stays until `rested` clears it.
 */
export const PetMoodParams = z.object({
  petId: z.string().min(1),
  mood: z.enum(['wince', 'cheer', 'tired', 'rested']),
});
export type PetMoodParams = z.infer<typeof PetMoodParams>;

/**
 * The health check: whether the browser extension is connected right now. Desktop only (the
 * extension may not ask); nothing else about a host is said.
 */
export const HostsStatusParams = z.object({});
export const HostsStatusResult = z.object({ extension: z.boolean() });
export type HostsStatusResult = z.infer<typeof HostsStatusResult>;

/**
 * Gentle nudges. The host sends the idle time and the window titles once a minute, only
 * while the setting is on and sight is not paused. Any line comes back as `pet.remark`, the
 * face as `pet.mood` (`tired`, then `rested` after a break).
 */
export const WellbeingObserveParams = z.object({
  idleMs: z.number().nonnegative(),
  windows: z.array(WindowEntry),
});
export const WellbeingObserveResult = Empty;

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
  'settings.get': { params: SettingsGetParams, result: SettingsGetResult },
  'settings.set': { params: SettingsSetParams, result: SettingsSetResult },
  'models.list': { params: ModelsListParams, result: ModelsListResult },
  'providers.check': { params: ProvidersCheckParams, result: ProvidersCheckResult },
  'tool.approve': { params: ToolApproveParams, result: ToolApproveResult },
  'watch.stop': { params: WatchStopParams, result: WatchStopResult },
  'activity.list': { params: ActivityListParams, result: ActivityListResult },
  'experts.list': { params: ExpertsListParams, result: ExpertsListResult },
  'experts.upsert': { params: ExpertsUpsertParams, result: ExpertsUpsertResult },
  'experts.delete': { params: ExpertsDeleteParams, result: ExpertsDeleteResult },
  'experts.test': { params: ExpertsTestParams, result: ExpertsTestResult },
  'handoffs.cancel': { params: HandoffsCancelParams, result: HandoffsCancelResult },
  'handoffs.confirm': { params: HandoffsConfirmParams, result: HandoffsConfirmResult },
  'handoffs.dismiss': { params: HandoffsDismissParams, result: HandoffsDismissResult },
  'projects.search': { params: ProjectsSearchParams, result: ProjectsSearchResult },
  'greeting.compose': { params: GreetingComposeParams, result: GreetingComposeResult },
  'keepAnEye.observe': { params: KeepAnEyeObserveParams, result: KeepAnEyeObserveResult },
  'keepAnEye.notNow': { params: KeepAnEyeNotNowParams, result: KeepAnEyeNotNowResult },
  'keepAnEye.accept': { params: KeepAnEyeAcceptParams, result: KeepAnEyeAcceptResult },
  'connections.list': { params: ConnectionsListParams, result: ConnectionsListResult },
  'connections.add': { params: ConnectionsAddParams, result: ConnectionsAddResult },
  'connections.setEnabled': {
    params: ConnectionsSetEnabledParams,
    result: ConnectionsSetEnabledResult,
  },
  'connections.signIn': { params: ConnectionsSignInParams, result: ConnectionsSignInResult },
  'connections.remove': { params: ConnectionsRemoveParams, result: ConnectionsRemoveResult },
  'routines.list': { params: RoutinesListParams, result: RoutinesListResult },
  'routines.save': { params: RoutinesSaveParams, result: RoutinesSaveResult },
  'routines.delete': { params: RoutinesDeleteParams, result: RoutinesDeleteResult },
  'routines.setEnabled': { params: RoutinesSetEnabledParams, result: RoutinesSetEnabledResult },
  'routines.runNow': { params: RoutinesRunNowParams, result: RoutinesRunNowResult },
  'routines.confirm': { params: RoutinesConfirmParams, result: RoutinesConfirmResult },
  'routines.dismiss': { params: RoutinesDismissParams, result: RoutinesDismissResult },
  'pickUp.rebrief': { params: PickUpRebriefParams, result: PickUpRebriefResult },
  'pickUp.dismiss': { params: PickUpDismissParams, result: PickUpDismissResult },
  'sightLog.list': { params: SightLogListParams, result: SightLogListResult },
  'sightLog.delete': { params: SightLogDeleteParams, result: SightLogDeleteResult },
  'sightLog.clear': { params: SightLogClearParams, result: SightLogClearResult },
  'calendar.setLink': { params: CalendarSetLinkParams, result: CalendarSetLinkResult },
  'calendar.check': { params: CalendarCheckParams, result: CalendarCheckResult },
  'usage.summary': { params: UsageSummaryParams, result: UsageSummaryResult },
  'hosts.status': { params: HostsStatusParams, result: HostsStatusResult },
  'wellbeing.observe': { params: WellbeingObserveParams, result: WellbeingObserveResult },
  'experts.catalog': { params: ExpertsCatalogParams, result: ExpertsCatalogResult },
  'experts.install': { params: ExpertsInstallParams, result: ExpertsInstallResult },
  // What Scout remembers, in Home.
  'memory.list': { params: MemoryListParams, result: MemoryListResult },
  'memory.delete': { params: MemoryDeleteParams, result: MemoryDeleteResult },
} as const satisfies Record<string, MethodSpec>;

export const coreToHostMethods = {
  'perception.capture': { params: PerceptionCaptureParams, result: PerceptionCaptureResult },
  'perception.captureRegion': {
    params: PerceptionCaptureRegionParams,
    result: PerceptionCaptureRegionResult,
  },
  'perception.captureWindow': {
    params: PerceptionCaptureWindowParams,
    result: PerceptionCaptureWindowResult,
  },
  'perception.listWindows': {
    params: PerceptionListWindowsParams,
    result: PerceptionListWindowsResult,
  },
  'perception.readText': { params: PerceptionReadTextParams, result: PerceptionReadTextResult },
  'perception.recall': { params: PerceptionRecallParams, result: PerceptionRecallResult },
  'perception.diff': { params: PerceptionDiffParams, result: PerceptionDiffResult },
  'screen.pointAt': { params: ScreenPointAtParams, result: ScreenPointAtResult },
} as const satisfies Record<string, MethodSpec>;

export const coreToHostNotifications = {
  'turn.started': { params: TurnStartedParams },
  'turn.delta': { params: TurnDeltaParams },
  'turn.toolRequest': { params: TurnToolRequestParams },
  'turn.toolResult': { params: TurnToolResultParams },
  'turn.completed': { params: TurnCompletedParams },
  'turn.error': { params: TurnErrorParams },
  'turn.warning': { params: TurnWarningParams },
  'watch.fired': { params: WatchFiredParams },
  'watch.status': { params: WatchStatusParams },
  'handoff.proposed': { params: HandoffProposedParams },
  'handoff.progress': { params: HandoffProgressParams },
  'handoff.finished': { params: HandoffFinishedParams },
  'pet.remark': { params: PetRemarkParams },
  'connections.changed': { params: ConnectionsChangedParams },
  'connector.confirm': { params: ConnectorConfirmParams },
  'routine.proposed': { params: RoutineProposedParams },
  'routine.result': { params: RoutineResultParams },
  'routines.changed': { params: RoutinesChangedParams },
  'pet.mood': { params: PetMoodParams },
  'pickUp.ready': { params: PickUpReadyParams },
  'settings.proposed': { params: SettingsProposedParams },
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
