/**
 * What the desktop saw when the person asked: the context snapshot and its parts (images,
 * displays, the window inventory, something dropped on Scout). Contains ContextSnapshot,
 * PerceptionTarget, CaptureBlock and the shapes they are built from. Imports only zod, so
 * desktop main and the renderer share it.
 */
import { z } from 'zod';

/** A selection is always kept whole up to this length; beyond it the desktop truncates. */
export const MAX_SELECTION_CHARS = 20_000;

/**
 * Which configured entry refused a capture.
 *
 * Carries the matching rule rather than a bare boolean so the UI can say "1Password.exe is
 * on your exclusion list" instead of "blocked", and so a user who did not expect a refusal
 * can find the line that caused it. The reason travels with the snapshot because a
 * full-view capture refuses one display or one window while returning the rest.
 */
export const CaptureBlock = z.object({
  rule: z.enum(['processName', 'titlePattern']),
  /** The exclusion entry exactly as the user wrote it, for display. */
  entry: z.string().min(1),
});
export type CaptureBlock = z.infer<typeof CaptureBlock>;

/**
 * A picture a host captured. PNG only, so providers get one predictable image format.
 * The one shape is shared by the screenshot, each display and the composite.
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
   * it. Absent when the host has no count, and always absent for a blocked window: the
   * count is itself a small leak.
   */
  textChars: z.number().int().nonnegative().optional(),
  /** Present when an exclusion refuses this window. No text and no count are returned. */
  blocked: CaptureBlock.optional(),
  /** True when the window covers its whole screen: a game, a video, a presentation. */
  fullScreen: z.boolean().optional(),
});
export type WindowEntry = z.infer<typeof WindowEntry>;

/**
 * Something the person dropped on Scout's figure: selected text, a link, a file or an image.
 *
 * Its own field rather than `selection` or `screenshot`, so Scout never calls a dropped
 * picture "your screenshot". `text` is the text dropped, the link's address, or a text
 * file's contents; a file Tagalong does not read (a PDF, a Word file, one too big) comes
 * with its name, path and size only.
 */
export const DroppedKind = z.enum(['text', 'link', 'file', 'image']);
export type DroppedKind = z.infer<typeof DroppedKind>;

export const Dropped = z.object({
  kind: DroppedKind,
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  /** In bytes, for a file. */
  size: z.number().int().nonnegative().optional(),
  text: z.string().max(MAX_SELECTION_CHARS).optional(),
  image: CapturedImage.optional(),
});
export type Dropped = z.infer<typeof Dropped>;

/**
 * What the desktop saw at the moment the user asked. Every field beyond the identity
 * triple is optional: a capture holds only what was asked for and allowed.
 */
export const ContextSnapshot = z.object({
  id: z.uuid(),
  capturedAt: z.iso.datetime(),
  host: z.literal('desktop'),
  app: z
    .object({
      name: z.string().min(1),
      windowTitle: z.string().optional(),
      /**
       * Set by the desktop when the window is a blind spot or excluded. Its title is then
       * left out, so this is how the brain still knows to refuse.
       */
      blocked: CaptureBlock.optional(),
    })
    .optional(),
  selection: z.string().max(MAX_SELECTION_CHARS).optional(),
  clipboard: z.string().optional(),
  /** A single screenshot. `displays` and `composite` carry the full view. */
  screenshot: CapturedImage.optional(),
  /**
   * Every display, in the order the host enumerated them.
   *
   * A display may arrive with no `image`: the capturer offers no source for a screen it
   * was not allowed to read, and an honest gap beats a stale or invented picture.
   */
  displays: z.array(DisplaySnapshot).optional(),
  /** Every display drawn into one picture, laid out by monitor geometry. */
  composite: CapturedImage.optional(),
  /**
   * Every top-level window, with no text in it. It rides along with every full-view
   * capture, so it stays cheap; the pet spends a tool call to read inside one.
   */
  windows: z.array(WindowEntry).optional(),
  /** What the person dropped on Scout and then chose to send, with a button. */
  dropped: Dropped.optional(),
});
export type ContextSnapshot = z.infer<typeof ContextSnapshot>;

/** The things the desktop can be asked to perceive. */
export const PerceptionTarget = z.enum([
  'selection',
  'screenshot',
  'activeWindow',
  'clipboard',
  'pageText',
  /** Every display plus the composite. */
  'displays',
  /** The window inventory, with no window text in it. */
  'windows',
]);
export type PerceptionTarget = z.infer<typeof PerceptionTarget>;
