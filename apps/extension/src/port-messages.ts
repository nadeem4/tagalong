/**
 * The messages between extension pages and the service worker over their one port, and the
 * slice of chrome.runtime.Port both ends use.
 */
import type {
  ContextSnapshot,
  CoreToHostNotification,
  HostToCoreMethod,
  PerceptionTarget,
} from '@tagalong/protocol';
import type { ConnectionStatus } from './engine-connection';

/** The one port name extension pages use to reach the service worker. */
export const PORT_NAME = 'tagalong';

/** Side panel or options page to the service worker. */
export type PageMessage =
  | { type: 'call'; id: number; method: HostToCoreMethod; params: unknown }
  /** Reads the tab the panel sits beside: selection, page text, title. */
  | { type: 'capture'; id: number; targets: readonly PerceptionTarget[] }
  /** Port traffic resets the service worker's idle timer while a panel is open. */
  | { type: 'ping' };

/** The service worker to every open page. */
export type WorkerMessage =
  | { type: 'status'; status: ConnectionStatus }
  | { type: 'notification'; method: CoreToHostNotification; params: unknown }
  | { type: 'reply'; id: number; ok: true; result: unknown }
  | { type: 'reply'; id: number; ok: false; error: string }
  /**
   * What the shortcut captured, or the tab the user switched to, for the panel to attach to
   * the next ask. Null when the new tab could not be read: a chip still naming the previous
   * tab would send the wrong page.
   */
  | { type: 'context'; snapshot: ContextSnapshot | null };

/** The slice of `chrome.runtime.Port` both ends use, so tests can pair two fakes. */
export interface PortLike {
  postMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}
