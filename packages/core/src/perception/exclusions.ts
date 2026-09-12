import type { CaptureExclusions } from '@tagalong/protocol';

/**
 * The little a host knows about the focused window when it asks whether it may capture.
 * Both fields are optional because hosts differ and Windows sometimes reports neither.
 */
export interface ActiveWindow {
  readonly processName?: string;
  readonly title?: string;
}

/** Which configured entry refused the capture, so the UI can say why rather than "blocked". */
export interface CaptureBlock {
  readonly rule: 'processName' | 'titlePattern';
  /** The exclusion entry as the user wrote it, for display. */
  readonly entry: string;
}

/**
 * Windows process names are not case-stable — the same binary is reported as `Chrome.exe`,
 * `chrome.exe` or `CHROME.EXE` depending on who asked — and hosts differ on whether they
 * include the extension. Folding both away is what makes an exclusion list a user can
 * hand-edit actually work.
 */
function normalizeProcessName(name: string): string {
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
