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

export { PetRegistry, SCOUT } from './pets/registry';

export {
  InMemorySecretStore,
  SETTINGS_FILENAME,
  SettingsStore,
  type SecretStore,
} from './settings/settings';

export {
  GET_SELECTION,
  LOOK_AT_SCREEN,
  createPerceptionToolset,
  findCaptureBlock,
  mayPersistScreenshot,
  type ActiveWindow,
  type CaptureBlock,
  type PerceptionHost,
  type PerceptionToolset,
  type PerceptionToolsetOptions,
  type ToolOutcome,
} from './perception';

export { DB_FILENAME, LATEST_SCHEMA_VERSION, migrate, openDatabase } from './memory/db';
export { ConversationStore } from './memory/store';

export {
  AnthropicProvider,
  BrainError,
  FakeBrainProvider,
  createProvider,
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
  ConversationRunner,
  assemblePrompt,
  type RunAsk,
  type TurnEvent,
  type TurnEventSink,
  type TurnHandle,
  type TurnOutcome,
} from './conversation';

export { EngineServer, type HostSession, type MethodHandlers } from './server/ws-server';
export { PAIRING_FILENAME, readOrCreatePairingToken } from './server/pairing';
