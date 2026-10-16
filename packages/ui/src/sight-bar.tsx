/**
 * The chat panel's sight bar: what is attached to the next ask (window, page, screens,
 * selection), a rough token estimate for its images, and Look and Clear. Contains SightBar,
 * SightProblem and estimateImageTokens. Used by ChatPanel.
 */

import type { ContextSnapshot } from '@tagalong/protocol';

/** Why the pet cannot see, when the reason is worth saying out loud. */
export type SightProblem = 'blocked' | 'failed';

export interface SightBarProps {
  /** Null when nothing is attached — the bar still renders, it just says so. */
  snapshot: ContextSnapshot | null;
  problem: SightProblem | null;
  /** Asks the host for a screenshot of the active window. */
  onLook: () => void;
  /** Drops the attached context without closing the panel. */
  onClear: () => void;
  /**
   * What the Look button says. The browser host reads the page rather than photographing
   * the screen, and a button promising a screenshot it will not take is a small lie.
   */
  lookLabel?: string;
}

/**
 * Sight is a state, so the bar is always on screen and never renders nothing: a pet that
 * cannot see must look different from one that can, before anyone asks.
 */
export function SightBar({
  snapshot,
  problem,
  onLook,
  onClear,
  lookLabel = 'Look at screen',
}: SightBarProps) {
  const attached = describe(snapshot);
  const seeing = attached !== null;
  const state = seeing ? 'seeing' : (problem ?? 'blind');
  // The composite stands in when there is no single screenshot: a full-view capture has
  // no one screen to show, and the map of the desk is the honest thumbnail for it.
  const screenshot = snapshot?.screenshot ?? snapshot?.composite;
  const images = attachedImages(snapshot);
  const imageTokens = estimateImageTokens(images);

  return (
    <div
      data-testid="sight-bar"
      data-state={state}
      className={`flex items-center gap-2 border-b px-3 py-1.5 text-xs ${
        seeing ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'
      }`}
    >
      <span aria-hidden="true">{seeing ? '👁' : '🚫'}</span>
      <span className={`font-semibold ${seeing ? 'text-amber-700' : 'text-slate-500'}`}>
        {seeing ? 'Seeing' : LABEL_BY_PROBLEM[problem ?? 'blind']}
      </span>
      {screenshot !== undefined && (
        <img
          data-testid="sight-thumbnail"
          src={`data:${screenshot.mime};base64,${screenshot.base64}`}
          alt="Screenshot attached to the next ask"
          className="h-6 w-10 rounded border border-amber-200 object-cover"
        />
      )}
      {attached !== null && <span className="truncate text-slate-600">{attached}</span>}
      {images.length > 0 && (
        <span
          data-testid="image-tokens"
          title="Estimated input tokens for the attached images: width × height ÷ 750 each"
          className="shrink-0 text-slate-500"
        >
          ~{imageTokens.toLocaleString('en-US')} image tokens
          {images.length > 1 ? ` · ${images.length} images` : ''}
        </span>
      )}
      <span className="ml-auto flex shrink-0 gap-1.5">
        {seeing ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600"
          >
            Clear
          </button>
        ) : (
          <button
            type="button"
            onClick={onLook}
            className="rounded-md border border-dashed border-slate-400 bg-white px-2 py-0.5 font-medium text-slate-600"
          >
            {lookLabel}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * The screens, numbered the way the composite labels them.
 *
 * Counted out loud because a full-view capture shares three times as much of the desk as
 * a single screenshot, and the bar's job is to make a wrong capture obvious before the
 * answer arrives rather than after. A blanked screen is named as blocked rather than
 * silently omitted: a missing number reads as a screen that was captured.
 */
function describeDisplays(displays: NonNullable<ContextSnapshot['displays']>): string {
  const marks = displays.map((display, index) => {
    const ordinal = index + 1;
    if (display.blocked !== undefined) return `${ordinal} blocked`;
    return display.focused ? `${ordinal}◂` : `${ordinal}`;
  });
  return `${displays.length} screens: ${marks.join(' ')}`;
}

/**
 * Roughly what attached images cost as model input: width times height over 750 per image.
 *
 * Anthropic's published rule of thumb, and close enough for the other providers to say
 * "this ask carries about two thousand tokens of pictures" before it is sent. An estimate,
 * shown as one, not a bill.
 */
export function estimateImageTokens(images: readonly { width: number; height: number }[]): number {
  return Math.round(images.reduce((sum, image) => sum + (image.width * image.height) / 750, 0));
}

/** Every picture an ask would carry: the screenshot, the composite and each display's own. */
function attachedImages(snapshot: ContextSnapshot | null): { width: number; height: number }[] {
  if (snapshot === null) return [];
  return [
    ...(snapshot.screenshot === undefined ? [] : [snapshot.screenshot]),
    ...(snapshot.composite === undefined ? [] : [snapshot.composite]),
    ...(snapshot.displays ?? []).flatMap((display) =>
      display.image === undefined ? [] : [display.image],
    ),
  ];
}

const LABEL_BY_PROBLEM: Record<SightProblem | 'blind', string> = {
  blind: 'Not seeing anything',
  blocked: 'Capture is blocked here',
  failed: 'Capture did not work',
};

/**
 * Names what leaves the machine rather than counting it: a wrong capture has to be
 * obvious before the answer arrives, not after. Null means nothing is attached.
 */
function describe(snapshot: ContextSnapshot | null): string | null {
  if (snapshot === null) {
    return null;
  }

  const parts: string[] = [];
  if (snapshot.selection !== undefined && snapshot.selection.length > 0) {
    parts.push(`${snapshot.selection.length} chars`);
  }
  if (snapshot.screenshot !== undefined) {
    parts.push(`screen ${snapshot.screenshot.width}×${snapshot.screenshot.height}`);
  }
  if (snapshot.displays !== undefined && snapshot.displays.length > 0) {
    parts.push(describeDisplays(snapshot.displays));
  }
  if (snapshot.page !== undefined) {
    parts.push(`page “${snapshot.page.title || snapshot.page.url}”`);
  }
  // A browser tab's title is the page title, so the window is named only when no page is.
  if (snapshot.app !== undefined && snapshot.page === undefined) {
    parts.push(
      snapshot.app.windowTitle === undefined
        ? snapshot.app.name
        : `${snapshot.app.name} — ${snapshot.app.windowTitle}`,
    );
  }
  return parts.length === 0 ? null : parts.join(' · ');
}
