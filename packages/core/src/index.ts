/**
 * The Tagalong Engine.
 *
 * Pure Node TypeScript. This package must never import electron, react, or DOM globals;
 * an ESLint no-restricted-imports rule enforces that.
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
