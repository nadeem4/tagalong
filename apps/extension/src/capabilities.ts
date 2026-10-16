/**
 * What the extension tells the engine it can perceive: the exact selection, the readable
 * text of the page, and which tab that is. No screenshot and no display enumeration —
 * the desktop host owns those, and a host advertising them would be asked for them.
 */
import type { HostCapability } from '@tagalong/protocol';

export const EXTENSION_CAPABILITIES = [
  'selection',
  'pageText',
  'activeWindow',
] as const satisfies readonly HostCapability[];
