/**
 * Electron host entry point.
 *
 * Phase 1 replaces this with the electron-vite main process that boots the engine,
 * owns the tray, and takes the single-instance lock. For now it only proves the
 * workspace wiring: the desktop app can see core, which can see protocol.
 */
import { engineInfo } from '@tagalong/core';

export function describeHost(): string {
  const engine = engineInfo();
  return `tagalong-desktop -> ${engine.name} (protocol ${engine.protocolVersion}) at ${engine.url}`;
}
