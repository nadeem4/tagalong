/**
 * Remembers where the user left Scout. The desktop owns the settings file now (the brain
 * has no settings.set), so the spot goes straight to the store and into the live settings.
 */
import type { Settings, SettingsPatch } from '../shared/settings';

export function saveAvatarSpot(
  store: { set(patch: SettingsPatch): Settings },
  position: { x: number | null; y: number | null },
  onSaved: (saved: Settings) => void,
): void {
  try {
    onSaved(store.set({ avatar: position }));
  } catch (error) {
    console.warn('[main] could not persist avatar position', error);
  }
}
