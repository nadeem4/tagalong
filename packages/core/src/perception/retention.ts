import type { ContextSnapshot, ScreenshotRetention } from '@tagalong/protocol';

/**
 * Whether this snapshot's screenshot may be written to the database.
 *
 * Takes the snapshot rather than just the setting so the "there is no image" case and the
 * "retention is off" case are answered in one place: a caller that has to remember to check
 * both is a caller that will one day forget the second one.
 *
 * This decides persistence only. A screenshot that may not be stored is still sent to the
 * provider for the turn the user asked for — the privacy promise is about the database,
 * not about the pet being blind.
 */
export function mayPersistScreenshot(
  snapshot: Pick<ContextSnapshot, 'screenshot'>,
  retention: ScreenshotRetention,
): boolean {
  if (!snapshot.screenshot) return false;
  return retention.mode === 'hours';
}
