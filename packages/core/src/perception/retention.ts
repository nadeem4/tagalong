import type { ContextSnapshot, ScreenshotRetention } from '@tagalong/protocol';

/**
 * Whether this snapshot's pictures may be written to the database: its screenshot, and an
 * image dropped on Scout, which follows the same rule.
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
  snapshot: Pick<ContextSnapshot, 'screenshot' | 'dropped'>,
  retention: ScreenshotRetention,
): boolean {
  if (!snapshot.screenshot && !snapshot.dropped?.image) return false;
  return retention.mode === 'hours';
}

/** Whether the snapshot holds a picture that `withoutPixels` would take out. */
export function hasPixels(snapshot: Pick<ContextSnapshot, 'screenshot' | 'dropped'>): boolean {
  return snapshot.screenshot !== undefined || snapshot.dropped?.image !== undefined;
}

/**
 * The snapshot minus its screenshot and a dropped image; a dropped item's name, path and
 * text stay, like a selection.
 *
 * Rebuilt by destructuring rather than by assigning `undefined`, because
 * `exactOptionalPropertyTypes` treats a present-but-undefined field as a different thing
 * from an absent one — and so does `JSON.stringify`, which is what reaches the row.
 */
export function withoutPixels(snapshot: ContextSnapshot): ContextSnapshot {
  const { screenshot: _screenshot, dropped, ...rest } = snapshot;
  if (dropped === undefined) return rest;
  const { image: _image, ...kept } = dropped;
  return { ...rest, dropped: kept };
}
