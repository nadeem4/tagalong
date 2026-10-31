/**
 * Reading window text out of the accessibility tree, behind TextLayerProvider. Contains
 * createUiaTextLayer and parseWindowCounts.
 */

import {
  WINDOW_TEXT_WALK_MS,
  countWindowTextScript,
  parseWindowText,
  readWindowTextScript,
} from './window-text';
import type { WindowTextReading } from './window-text';

/**
 * Reading text out of windows, behind an interface.
 *
 * Nothing above this interface knows which operating system it is talking to, or that
 * PowerShell is involved at all.
 */
export interface TextLayerProvider {
  /** The text of one window, capped. Never rejects; an unreadable window reads as empty. */
  readWindowText(handle: number, maxChars: number): Promise<WindowTextReading>;
  /**
   * Readable characters per window, for the inventory.
   *
   * Takes the whole list because each call starts a PowerShell process, and a twelve
   * window desktop must not mean twelve of them. Windows the caller may not read are
   * expected to have been filtered out already — counting one would mean walking it.
   */
  countWindowText(handles: readonly number[]): Promise<Map<number, number>>;
}

/** Runs a script and resolves with whatever it printed. */
type RunScript = (script: string, timeoutMs: number) => Promise<string>;

/** How long the counting pass may take in total, across every window in it. */
const COUNT_PASS_TIMEOUT_MS = 5_000;

function isCountRow(value: unknown): value is { handle: number; chars: number } {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as { handle?: unknown; chars?: unknown };
  return (
    typeof row.handle === 'number' &&
    Number.isFinite(row.handle) &&
    typeof row.chars === 'number' &&
    Number.isFinite(row.chars) &&
    row.chars >= 0
  );
}

/**
 * Reads the counting pass's output.
 *
 * Forgiving in the same way the other parsers are, and for the same reason: a desktop
 * described a little less completely is a smaller loss than an ask that fails.
 */
export function parseWindowCounts(stdout: string): Map<number, number> {
  const counts = new Map<number, number>();
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return counts;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return counts;
  }

  for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
    if (isCountRow(row)) counts.set(row.handle, row.chars);
  }
  return counts;
}

/**
 * The Windows text layer, over UI Automation.
 *
 * Takes its script runner as a port, so every behaviour here — capping, ordering,
 * recovering from a helper that will not answer — is tested without a desktop. The real
 * runner spawns PowerShell; a test hands over a function that returns fixture output.
 *
 * Neither method rejects. PowerShell can be missing, blocked by policy, or simply slow,
 * and a window chosen from an inventory taken moments ago can be gone by the time the read
 * runs. Every one of those resolves to "nothing readable", which costs the pet some
 * knowledge, rather than to an exception, which costs the user their whole ask.
 */
export function createUiaTextLayer(run: RunScript): TextLayerProvider {
  return {
    async readWindowText(handle: number, maxChars: number): Promise<WindowTextReading> {
      try {
        const stdout = await run(readWindowTextScript(handle), WINDOW_TEXT_WALK_MS + 1_000);
        return parseWindowText(stdout, maxChars);
      } catch {
        // A throw is a read that never happened, which is not the same as a window with
        // nothing in it. Saying so keeps the caller from describing the window as empty.
        return { text: '', truncated: false, failure: 'no-output' };
      }
    },

    async countWindowText(handles: readonly number[]): Promise<Map<number, number>> {
      // No windows to count means no reason to start a process.
      if (handles.length === 0) return new Map();
      try {
        const stdout = await run(countWindowTextScript(handles), COUNT_PASS_TIMEOUT_MS);
        return parseWindowCounts(stdout);
      } catch {
        return new Map();
      }
    },
  };
}
