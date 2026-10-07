const KEY = 'tagalong.office.still';

/**
 * Whether the user asked for a still office, remembered in this page's localStorage. Any
 * storage failure (a blocked or missing store) reads as "not still" and is otherwise
 * ignored: the setting is a comfort, never a reason for the office to break.
 */
export function readStill(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeStill(still: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, still ? '1' : '0');
  } catch {
    // Not remembered this time; the toggle still works for this window.
  }
}
