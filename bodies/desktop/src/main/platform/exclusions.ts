/**
 * Capture exclusions: which window may not be read, by the built-in blind spots, secret file
 * names and the person's own list. Contains findCaptureBlock, secretFileRule and
 * normalizeProcessName. CaptureBlock itself lives in @tagalong/ui/shapes, where the panels share it.
 */
import { BUILT_IN_EXCLUSIONS, SECRET_FILES } from '../../shared/blind-spots';
import type { CaptureBlock } from '@tagalong/ui/shapes';
import type { CaptureExclusions } from '../../shared/settings';

/**
 * The little a host knows about the focused window when it asks whether it may capture.
 * Both fields are optional because hosts differ and Windows sometimes reports neither.
 */
export interface ActiveWindow {
  readonly processName?: string;
  readonly title?: string;
}

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
  for (const word of words) {
    const entry = secretFileRule(word);
    if (entry !== null) return { rule: 'titlePattern', entry };
  }
  return null;
}

/**
 * The secret-file name (`.env`, `id_rsa`, `secrets.*`) a bare file name matches, or null.
 * Shared by the title rule above and by a file dropped on Scout.
 */
export function secretFileRule(fileName: string): string | null {
  return SECRET_FILES.find((file) => globToRegExp(file).test(fileName)) ?? null;
}
