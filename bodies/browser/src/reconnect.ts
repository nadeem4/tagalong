/**
 * The alarm's redial rule. An outdated body is refused by the brain every time it dials, so
 * redialing it only makes the popup flicker; the person has to update the extension instead.
 */
import type { BrainStatus } from '@tagalong/contract';

export function shouldRedial(status: BrainStatus): boolean {
  return status !== 'online' && status !== 'outdated';
}
