/**
 * Wire contract shared by the engine and every host.
 *
 * This package depends on zod and nothing else. It must never import node, electron,
 * react, or DOM APIs, because both the Electron host and the Chrome host load it.
 */

/** Bumped whenever the JSON-RPC method catalog changes shape. */
export const PROTOCOL_VERSION = '0.5.0';

/** The engine only ever binds to loopback. */
export const ENGINE_HOST = '127.0.0.1';

/** Default port for the host websocket. Configurable when the port is taken. */
export const DEFAULT_ENGINE_PORT = 47321;

/** Websocket URL a host dials to reach a running engine. */
export function engineUrl(port: number = DEFAULT_ENGINE_PORT): string {
  return `ws://${ENGINE_HOST}:${port}`;
}

export * from './limits';
export * from './context';
export * from './pet';
export * from './message';
export * from './rpc';
export * from './settings';
export * from './awareness';
export * from './methods';
export * from './roles';
export * from './notices';
