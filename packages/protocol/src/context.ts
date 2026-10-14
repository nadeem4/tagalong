import { z } from 'zod';

import { MAX_PAGE_TEXT_CHARS, MAX_SELECTION_CHARS } from './limits';
import { CaptureBlock } from './settings';

/** Which host produced a snapshot. Hosts differ in what they can perceive. */
export const HostKind = z.enum(['desktop', 'extension']);
export type HostKind = z.infer<typeof HostKind>;

export { MAX_PAGE_TEXT_CHARS, MAX_SELECTION_CHARS } from './limits';

/**
 * A picture a host captured. PNG only, so providers get one predictable image format.
 *
 * Shared by the single screenshot, each display, and the composite rather than repeated at
 * each: three inline copies of the same four fields drift, and a provider that has to
 * special-case one of them is a provider that will get it wrong.
 */
export const CapturedImage = z.object({
  mime: z.literal('image/png'),
  base64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CapturedImage = z.infer<typeof CapturedImage>;

/**
 * Where a display sits on the virtual desktop, in device-independent pixels.
 *
 * `x` and `y` may be negative and often are: Windows puts the primary display at the
 * origin and gives a monitor to its left or above it negative coordinates.
 */
export const DisplayBounds = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type DisplayBounds = z.infer<typeof DisplayBounds>;

/** One monitor, as the host found it. */
export const DisplaySnapshot = z.object({
  id: z.number().int(),
  bounds: DisplayBounds,
  scaleFactor: z.number().positive(),
  primary: z.boolean(),
  /** True for the display holding the foreground window, if the OS reports one. */
  focused: z.boolean(),
  /** Present when an exclusion refused this display; its image is then a placeholder. */
  blocked: CaptureBlock.optional(),
  /** Absent when the capturer offered no usable source for this display. */
  image: CapturedImage.optional(),
});
export type DisplaySnapshot = z.infer<typeof DisplaySnapshot>;

/**
 * A display without its picture: enough to number the screens and say how big they are.
 *
 * Listed in the host's own order, the order the composite labels 1, 2, 3, so a window
 * list grouped by these reads as the same "screen 2" the user sees in the picture.
 */
export const ScreenInfo = DisplaySnapshot.pick({ id: true, bounds: true, primary: true });
export type ScreenInfo = z.infer<typeof ScreenInfo>;

/**
 * One top-level window in the inventory: what it is and where, never what is in it.
 *
 * The inventory is attached to every full-view capture, so it has to stay cheap. Reading a
 * window's text is a separate, deliberate tool call against a single `id`.
 */
export const WindowEntry = z.object({
  /** Opaque and host-assigned. Only the host that issued it can resolve it. */
  id: z.string().min(1),
  processName: z.string().min(1),
  /** May be empty. Plenty of real windows carry no title at all. */
  title: z.string(),
  displayId: z.number().int().optional(),
  state: z.enum(['foreground', 'background', 'minimized']),
  /**
   * A Chromium window, whose text layer covers its active tab only. The pet is told that
   * other tabs need the browser host rather than left to guess it can read them.
   */
  browser: z.boolean(),
  /**
   * How much text this window would yield, so the pet can judge a read before paying for
   * it. Absent until the text layer lands, and absent for a blocked window: the count is
   * itself a small leak, since knowing an excluded vault holds 4,000 characters says more
   * than nothing at all.
   */
  textChars: z.number().int().nonnegative().optional(),
  /** Present when an exclusion refuses this window. No text and no count are returned. */
  blocked: CaptureBlock.optional(),
  /** True when the window covers its whole screen: a game, a video, a presentation. */
  fullScreen: z.boolean().optional(),
});
export type WindowEntry = z.infer<typeof WindowEntry>;

/**
 * What a host saw at the moment the user asked. Every field beyond the identity
 * triple is optional, because hosts advertise different capabilities.
 */
export const ContextSnapshot = z.object({
  id: z.uuid(),
  capturedAt: z.iso.datetime(),
  host: HostKind,
  app: z
    .object({
      name: z.string().min(1),
      windowTitle: z.string().optional(),
      /**
       * Set by the desktop when the window is a blind spot or excluded. Its title is then
       * left out, so this is how the engine still knows to refuse.
       */
      blocked: CaptureBlock.optional(),
    })
    .optional(),
  selection: z.string().max(MAX_SELECTION_CHARS).optional(),
  clipboard: z.string().optional(),
  /** Supplied by the extension host only; the desktop host cannot read page text. */
  page: z
    .object({
      url: z.url(),
      title: z.string(),
      text: z.string().max(MAX_PAGE_TEXT_CHARS),
    })
    .optional(),
  /** Phase 2. PNG only, so providers get one predictable image format. */
  screenshot: CapturedImage.optional(),
  /**
   * Phase 2B. Every display, in the order the host enumerated them.
   *
   * A display may arrive with no `image`: the capturer offers no source for a screen it
   * was not allowed to read, and an honest gap beats a stale or invented picture.
   */
  displays: z.array(DisplaySnapshot).optional(),
  /** Phase 2B. Every display drawn into one picture, laid out by monitor geometry. */
  composite: CapturedImage.optional(),
  /**
   * Phase 2B. Every top-level window, with no text in it.
   *
   * Deliberately cheap: this rides along with every full-view capture, so it carries what
   * a window is and where it is, and the pet spends a tool call when it wants what is
   * inside one.
   */
  windows: z.array(WindowEntry).optional(),
});
export type ContextSnapshot = z.infer<typeof ContextSnapshot>;

/** What a host returns from perception.capture: whichever fields it managed to read. */
export const ContextSnapshotPatch = ContextSnapshot.partial();
export type ContextSnapshotPatch = z.infer<typeof ContextSnapshotPatch>;

/** The things a host can be asked to perceive. */
export const PerceptionTarget = z.enum([
  'selection',
  'screenshot',
  'activeWindow',
  'clipboard',
  'pageText',
  /** Phase 2B: every display plus the composite. */
  'displays',
  /** Phase 2B: the window inventory, with no window text in it. */
  'windows',
]);
export type PerceptionTarget = z.infer<typeof PerceptionTarget>;
