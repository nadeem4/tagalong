import { BUILT_IN_EXCLUSIONS, SECRET_FILES } from '@tagalong/protocol';
import type { CaptureBlock, CaptureExclusions } from '@tagalong/protocol';

/**
 * The little a host knows about the focused window when it asks whether it may capture.
 * Both fields are optional because hosts differ and Windows sometimes reports neither.
 */
export interface ActiveWindow {
  readonly processName?: string;
  readonly title?: string;
}

/**
 * Which configured entry refused the capture, re-exported from the protocol.
 *
 * It lives there rather than here because it now crosses the socket: a full-view capture
 * refuses one display or one window while returning the rest, so the reason has to travel
 * with the snapshot. Two structurally identical definitions would drift.
 */
export type { CaptureBlock };

/**
 * Windows process names are not case-stable — the same binary is reported as `Chrome.exe`,
 * `chrome.exe` or `CHROME.EXE` depending on who asked — and hosts differ on whether they
 * include the extension. Folding both away is what makes an exclusion list a user can
 * hand-edit actually work.
 */
export function normalizeProcessName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '');
}

/**
 * A glob with `*` as the only wildcard, anchored at both ends.
 *
 * Anchoring keeps the semantics predictable: `Windows Security` means that title and no
 * other, `*Bitwarden*` means "contains". Everything else is escaped, so a title pattern can
 * never smuggle in regex syntax — no user-authored quantifier, no alternation, and so no
 * pathological pattern that could stall a capture. Titles are short (Windows caps them
 * around 260 characters), which bounds the matching cost.
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`, 'i');
}

/**
 * The exclusion rule that forbids capturing this window, or null when capture may proceed.
 *
 * The built-in blind spots are checked first and always, whatever the person's own list
 * says, so clearing that list never takes them away.
 *
 * Not named `isCaptureBlocked` because it answers with the matching rule, not a boolean:
 * the caller has to tell the user which entry blocked them, and re-deriving that would
 * mean matching twice.
 *
 * An unidentifiable window is allowed. Refusing everything we cannot name would turn one
 * missing process name into a pet that never sees anything, which the user meets as a
 * broken app rather than as a privacy guarantee.
 */
export function findCaptureBlock(
  activeWindow: ActiveWindow | undefined,
  exclusions: CaptureExclusions,
): CaptureBlock | null {
  if (!activeWindow) return null;
  return (
    matchList(activeWindow, BUILT_IN_EXCLUSIONS) ??
    matchSecretFile(activeWindow.title) ??
    matchList(activeWindow, exclusions)
  );
}

function matchList(activeWindow: ActiveWindow, exclusions: CaptureExclusions): CaptureBlock | null {
  const processName = activeWindow.processName?.trim();
  if (processName) {
    const actual = normalizeProcessName(processName);
    const entry = exclusions.processNames.find((e) => normalizeProcessName(e) === actual);
    if (entry !== undefined) return { rule: 'processName', entry };
  }

  const title = activeWindow.title?.trim();
  if (title) {
    const entry = exclusions.titlePatterns.find((e) => globToRegExp(e).test(title));
    if (entry !== undefined) return { rule: 'titlePattern', entry };
  }

  return null;
}

/**
 * A secret file named in the title, the way an editor shows the open file: `.env - repo -
 * Visual Studio Code`, or a full path ending in `id_rsa`. Each word of the title, and the
 * last part of any path in it, is matched whole against the secret file names.
 */
function matchSecretFile(title: string | undefined): CaptureBlock | null {
  if (!title) return null;
  const words = title
    .split(/\s+/)
    .map((word) => word.split(/[\\/]/).pop() ?? '')
    .filter((word) => word.length > 0);
  for (const file of SECRET_FILES) {
    const pattern = globToRegExp(file);
    if (words.some((word) => pattern.test(word))) return { rule: 'titlePattern', entry: file };
  }
  return null;
}

/**
 * The block on a snapshot's `app`: the host's own mark when it set one (it leaves a blocked
 * window's title out, so the title rules cannot match again here), else the rules.
 */
export function appCaptureBlock(
  app:
    | { name: string; windowTitle?: string | undefined; blocked?: CaptureBlock | undefined }
    | undefined,
  exclusions: CaptureExclusions,
): CaptureBlock | null {
  if (app === undefined) return null;
  if (app.blocked !== undefined) return app.blocked;
  return findCaptureBlock(
    { processName: app.name, ...(app.windowTitle === undefined ? {} : { title: app.windowTitle }) },
    exclusions,
  );
}
