import type { Settings, SettingsPatch } from '@tagalong/protocol';

/** The slice of the settings store the launch record needs. */
export interface LaunchStore {
  get(): Settings;
  set(patch: SettingsPatch): Settings;
}

/** What the last launch left behind, read before this one overwrites it. */
export interface PreviousLaunch {
  /** It never recorded a clean close. */
  crashed: boolean;
  lastVersion: string | null;
}

/**
 * Called first thing at start: reads whether the last launch closed cleanly and which
 * version it ran, then marks this launch open on this version. A settings file that cannot
 * be read or written never stops the launch; it reads as a plain one.
 */
export function recordLaunch(store: LaunchStore, version: string): PreviousLaunch {
  try {
    const before = store.get();
    store.set({ closedCleanly: false, lastVersion: version });
    return { crashed: !before.closedCleanly, lastVersion: before.lastVersion };
  } catch (error) {
    console.warn('[main] could not record this launch:', error);
    return { crashed: false, lastVersion: null };
  }
}

/** A clean quit, or Windows ending the session: the next launch is not a crash. */
export function recordCleanClose(store: LaunchStore | null | undefined, now: Date): void {
  try {
    store?.set({ closedCleanly: true, lastClosedAt: now.toISOString() });
  } catch (error) {
    console.warn('[main] could not remember this quit:', error);
  }
}
