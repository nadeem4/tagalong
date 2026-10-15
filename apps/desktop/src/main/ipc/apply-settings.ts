import { SettingsPatch } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';

export interface ApplySettingsDeps {
  /** The same off path as the bubble's switch: closes the microphone, then saves it off. */
  listeningOff: () => unknown;
  /** The ordinary settings save, marked as applied from Scout's card. */
  save: (patch: SettingsPatch) => Promise<Settings>;
}

/**
 * Apply on Scout's settings card. Always listening's state lives in main's
 * `AlwaysListening`, so saving the file alone would not close the microphone: it is taken
 * out of the patch and switched off the way the bubble's switch does it. The rest is saved
 * through the ordinary settings path. A card never switches Always listening on.
 */
export async function applySettings(patch: unknown, deps: ApplySettingsDeps): Promise<void> {
  const { listening, ...rest } = SettingsPatch.parse(patch);
  if (listening?.always === true) {
    throw new Error(
      'Only you can switch Always listening on, in the bubble or Settings › Privacy.',
    );
  }
  if (listening !== undefined) deps.listeningOff();
  if (Object.keys(rest).length > 0) await deps.save(rest);
}
