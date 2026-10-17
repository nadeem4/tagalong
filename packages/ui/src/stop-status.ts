/**
 * The quiet status for a turn that ended with nothing said and a reason: shown under Scout,
 * never spoken and never stored as something Scout said. Contains `stopStatus`.
 */
import type { NotificationParamsOf } from '@tagalong/protocol';

type StopReason = NotificationParamsOf<'turn.completed'>['stopReason'];

/** "Declined" or "Stopped: too many steps" for an empty answer; otherwise null. */
export function stopStatus(text: string, stopReason: StopReason): string | null {
  if (text !== '') return null;
  if (stopReason === 'refusal') return 'Declined';
  if (stopReason === 'tool_limit') return 'Stopped: too many steps';
  return null;
}
