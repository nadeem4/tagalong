/**
 * React components shared by the desktop renderer and the extension side panel.
 *
 * This package must never import electron. Hosts hand it a HostBridge instead.
 * Components arrive in Phase 1; this file keeps the package buildable until then.
 */
import { PROTOCOL_VERSION } from '@tagalong/protocol';

/** Protocol version the components in this package are written against. */
export const UI_PROTOCOL_VERSION = PROTOCOL_VERSION;
