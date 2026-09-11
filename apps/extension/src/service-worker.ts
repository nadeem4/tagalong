/**
 * Chrome MV3 host entry point. Stub until Phase 6.
 *
 * This host never imports @tagalong/core. It speaks the protocol over the loopback
 * websocket and nothing else.
 */
import { engineUrl } from '@tagalong/protocol';

export function engineEndpoint(): string {
  return engineUrl();
}
