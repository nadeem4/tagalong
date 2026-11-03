/**
 * Time text for the job page. The brain sends ISO UTC; people read local time. A duration is
 * never negative, so a finish stamped before its start (clock skew) shows `0s`.
 * Contains clock, ranFor, localTime and localDateTime.
 */

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes}m ${total % 60}s` : `${total}s`;
}

/** `ended - started`, live against `now` while the end is null. */
export function ranFor(startedAt: string, endedAt: string | null, now: number): string {
  return clock((endedAt === null ? now : Date.parse(endedAt)) - Date.parse(startedAt));
}

export function localTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString();
}

export function localDateTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString();
}
