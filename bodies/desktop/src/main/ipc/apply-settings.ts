/**
 * Apply on Scout's settings card: checks the patch again and saves it, with Always listening taken
 * out and switched off on its own path. Contains applySettings.
 */

import { talkPatchProblem } from '@tagalong/core';
import { SettingsPatch } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';

export interface ApplySettingsDeps {
  /** The settings now, which the card's patch is checked against. */
  current: () => Promise<Settings>;
  /** The same off path as the bubble's switch: closes the microphone, then saves it off. */
  listeningOff: () => unknown;
  /** The ordinary settings save. */
  save: (patch: SettingsPatch) => Promise<Settings>;
}

/**
 * Apply on Scout's settings card. The patch comes from the renderer, so it is checked again
 * here against the chat allowlist (`talkPatchProblem`): a patch no card could hold is
 * refused whole. Always listening's state lives in main's `AlwaysListening`, so saving the
 * file alone would not close the microphone: it is taken out of the patch and switched off
 * the way the bubble's switch does it. The rest is saved through the ordinary settings
 * path. A card never switches Always listening on.
 */
export async function applySettings(patch: unknown, deps: ApplySettingsDeps): Promise<void> {
  const parsed = SettingsPatch.parse(patch);
  if (parsed.listening?.always === true) {
    throw new Error(
      'Only you can switch Always listening on, in the bubble or Settings › Privacy.',
    );
  }
  const problem = talkPatchProblem(await deps.current(), parsed);
  if (problem !== null) throw new Error(problem);
  const { listening, ...rest } = parsed;
  if (listening !== undefined) deps.listeningOff();
  if (Object.keys(rest).length > 0) await deps.save(rest);
}
