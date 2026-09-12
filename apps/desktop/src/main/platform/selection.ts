import { MAX_SELECTION_CHARS } from '@tagalong/protocol';

/**
 * The two clipboard operations selection capture needs, so tests can supply their own.
 * Both are async because Electron's clipboard API is modelled on the W3C one.
 */
export interface ClipboardPort {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

/**
 * How long to wait after Ctrl+C before reading the clipboard.
 *
 * The foreground app owns the copy, so there is no event to await — only a guess at how
 * long it takes. 150 ms is the phase page's starting point; the timing log below is what
 * makes tuning it a measurement instead of a guess.
 */
export const COPY_SETTLE_MS = 150;

export interface SelectionCaptureDeps {
  clipboard: ClipboardPort;
  /**
   * Presses Ctrl+C in whatever app is in front. This is the only keyboard automation in
   * Tagalong and it exists solely to read the selection.
   */
  sendCopy: () => Promise<void>;
  wait: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
  settleMs?: number;
}

/**
 * Reads the current selection by borrowing the clipboard, then handing it straight back.
 *
 * The user's clipboard is theirs: it is restored in a `finally` so a failed keystroke or
 * a slow app cannot leave the selection sitting where they expected their own copy.
 * A clipboard that did not change means the app had nothing selected to copy — reporting
 * the stale contents as "the selection" would send the user's unrelated clipboard to a
 * model, which is worse than reporting nothing.
 */
export async function captureSelectionWith(deps: SelectionCaptureDeps): Promise<string | null> {
  const {
    clipboard,
    sendCopy,
    wait,
    now = () => Date.now(),
    log = () => {},
    settleMs = COPY_SETTLE_MS,
  } = deps;

  const startedAt = now();
  const original = await clipboard.readText();

  try {
    await sendCopy();
    const copiedAt = now();
    await wait(settleMs);
    const after = await clipboard.readText();
    log(
      `captureSelection: copy ${copiedAt - startedAt}ms, settle ${settleMs}ms, ` +
        `total ${now() - startedAt}ms, ${after.length} chars`,
    );

    if (after.length === 0 || after === original) return null;
    return after.slice(0, MAX_SELECTION_CHARS);
  } finally {
    await clipboard.writeText(original);
  }
}
