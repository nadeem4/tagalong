/**
 * The Tagalong Engine.
 *
 * Pure Node TypeScript. This package must never import electron, react, or DOM globals;
 * an ESLint no-restricted-imports rule enforces that.
 *
 * A host boots an Engine and then speaks the protocol. Nothing below the facade is part
 * of the host-facing contract, which is what keeps the Electron host and the Chrome host
 * interchangeable.
 */
import { PROTOCOL_VERSION, engineUrl } from '@tagalong/protocol';

export interface EngineInfo {
  /** Stable identifier hosts see in the hello handshake. */
  readonly name: string;
  /** Protocol version this engine speaks. */
  readonly protocolVersion: string;
  /** Loopback websocket URL hosts should dial. */
  readonly url: string;
}

/** Describes the engine a host is about to connect to. */
export function engineInfo(port?: number): EngineInfo {
  return {
    name: 'tagalong-engine',
    protocolVersion: PROTOCOL_VERSION,
    url: engineUrl(port),
  };
}

export { ANTHROPIC_KEY, Engine, type EngineOptions } from './engine';

export { BOLT, DEFAULT_CREW, INK, INK_MODEL, PetRegistry, SCOUT } from './pets/registry';

export { getRole, listRoles, recommendedModel, type RecommendedModel } from './roles';

export {
  InMemorySecretStore,
  SETTINGS_FILENAME,
  SettingsStore,
  type SecretStore,
} from './settings/settings';

export {
  buildInventory,
  THIN_TEXT_CHARS,
  findCaptureBlock,
  textLayerNotes,
  isBrowserProcess,
  mayPersistScreenshot,
  normalizeProcessName,
  renderInventory,
  type ActiveWindow,
  type CaptureBlock,
  type TextLayerReading,
  type ObservedWindow,
  type PerceptionHost,
} from './perception';

export {
  GET_SELECTION,
  LOOK_AT_SCREEN,
  RECALL_SCREEN,
  WATCH_FOR,
  WHAT_CHANGED,
  ToolRegistry,
  toolsFor,
  type PerceptionToolsOptions,
  type Tool,
  type ToolContext,
  type ToolFilter,
  type ToolKind,
  type ToolOutcome,
  type TurnTools,
} from './tools';
/** @deprecated Renamed to `PerceptionToolsOptions` when the tools moved to one module. */
export type { PerceptionToolsOptions as PerceptionToolsetOptions } from './tools';
/** @deprecated The per-turn tool set is `TurnTools`, from `ToolRegistry.forTurn`. */
export type { TurnTools as PerceptionToolset } from './tools';

export { DB_FILENAME, LATEST_SCHEMA_VERSION, migrate, openDatabase } from './memory/db';
export { ConversationStore } from './memory/store';
export {
  MemoryStore,
  ftsQuery,
  type Memory,
  type MemoryKind,
  type MemoryScope,
  type NewMemory,
} from './memory/memories';

export {
  AnthropicProvider,
  BrainError,
  FakeBrainProvider,
  NEBIUS_BASE_URL,
  NEBIUS_FALLBACK_MODELS,
  NEMOTRON_TEXT_MODEL,
  NEBIUS_VISION_MODELS,
  NEMOTRON_VISION_MODEL,
  CLAUDE_CODE_MODELS,
  ClaudeCodeBrain,
  NEMOTRON_NANO_MODEL,
  WATCH_MODEL_DEFAULTS,
  watchModelsFor,
  OPENAI_COMPATIBLE_PRESETS,
  OpenAiCompatibleProvider,
  SECRET_KEYS,
  carriesImage,
  createProvider,
  modelForTurn,
  openAiPreset,
  type OpenAiPreset,
  type BrainCapabilities,
  type BrainContent,
  type BrainContentBlock,
  type BrainErrorCode,
  type BrainEvents,
  type BrainMessage,
  type BrainProvider,
  type BrainRequest,
  type BrainResult,
  type BrainTool,
  type ProviderConfig,
} from './providers';

export {
  ClaudeCodeConnector,
  FakeConnector,
  renderBrief,
  type Brief,
  type Connector,
  type ConnectorResult,
} from './experts';

export {
  ConversationRunner,
  assemblePrompt,
  type RunAsk,
  type TurnEvent,
  type TurnEventSink,
  type TurnHandle,
  type TurnOutcome,
} from './conversation';

export {
  WATCH_CHANGE_THRESHOLD,
  WATCH_POLL_MS,
  WATCH_SETTLE_MS,
  WatchManager,
  type WatchEvent,
  type WatchInfo,
} from './watch';

export { EngineServer, type HostSession, type MethodHandlers } from './server/ws-server';
export { PAIRING_FILENAME, readOrCreatePairingToken } from './server/pairing';
