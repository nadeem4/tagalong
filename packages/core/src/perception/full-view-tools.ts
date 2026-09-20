import type { DisplayBounds, DisplaySnapshot, HostCapability } from '@tagalong/protocol';
import type { BrainContentBlock } from '../providers';
import type { CaptureBlock } from './exclusions';
import { renderInventory } from './inventory';

/**
 * The Phase 2B half of the toolset: every display, and any window by name.
 *
 * Split from `tools.ts` rather than appended to it. That file owns the Phase 2 pair and
 * the capture path they share; these five share a different spine — a display id or a
 * window id, fetched from a listing the pet is told to call first — and keeping them
 * apart keeps either file small enough to hold in one piece.
 */

/** Phase 2B tool names, as the model sees them. */
export const LIST_DISPLAYS = 'list_displays';
export const LOOK_AT_DISPLAY = 'look_at_display';
export const LOOK_CLOSER = 'look_closer';
export const LIST_WINDOWS = 'list_windows';
export const READ_WINDOW_TEXT = 'read_window_text';

/** How large a `look_closer` crop may come back. The same ceiling as every other image. */
const CROP_LONG_SIDE = 1568;

/**
 * What these tools need from the toolset, so this module does not depend on its options
 * shape and cannot reach anything else in it.
 */
export interface FullViewContext {
  displays(): Promise<readonly DisplaySnapshot[] | undefined>;
  host<K extends 'captureRegion' | 'listWindows' | 'readText'>(
    capability: HostCapability,
    method: K,
  ): FullViewHost<K> | undefined;
  vision(): boolean;
  /** The user's configured per-window character cap, read fresh on every call. */
  windowTextBudget(): number;
}

interface CaptureRegionParams {
  displayId: number;
  rect: DisplayBounds;
  maxLongSide: number;
}

export interface FullViewMethods {
  captureRegion(params: CaptureRegionParams): Promise<{ image: CapturedImageLike }>;
  listWindows(): Promise<{ windows: readonly WindowEntryLike[] }>;
  readText(params: { windowId?: string; maxChars: number }): Promise<ReadingLike>;
}

type FullViewHost<K extends keyof FullViewMethods> = Pick<FullViewMethods, K>;

interface CapturedImageLike {
  mime: 'image/png';
  base64: string;
  width: number;
  height: number;
}

type WindowEntryLike = Parameters<typeof renderInventory>[0][number];

interface ReadingLike {
  windowId: string;
  text: string;
  truncated: boolean;
  source: 'uia' | 'ocr';
  blocked?: CaptureBlock;
  notes?: string[];
}

/**
 * The same shape as `ToolOutcome` in `tools.ts`, declared here from the provider block
 * type rather than imported from it: `tools.ts` imports this module, and taking the type
 * back from it would close the cycle.
 */
interface Outcome {
  content: string | BrainContentBlock[];
  isError?: boolean;
}

function noHost(what: string): Outcome {
  return {
    content: `No connected host can ${what} right now. Tell the user that rather than guessing.`,
    isError: true,
  };
}

/** A host that cannot answer surfaces as a tool result; throwing would kill the turn. */
function hostFailure(error: unknown): Outcome {
  const message = error instanceof Error ? error.message : String(error);
  return { content: `The host could not answer: ${message}`, isError: true };
}

function refusalWording(block: CaptureBlock): string {
  const how = block.rule === 'processName' ? 'application' : 'window title pattern';
  return `the ${how} ${quote(block.entry)} on the capture exclusion list`;
}

function quote(value: string): string {
  return `"${value}"`;
}

export async function runListDisplays(context: FullViewContext): Promise<Outcome> {
  try {
    const displays = await context.displays();
    if (displays === undefined) return noHost('enumerate the displays');
    if (displays.length === 0) {
      return { content: 'The host reported no displays at all.', isError: true };
    }

    const lines = displays.map((display, index) => {
      const { width, height, x, y } = display.bounds;
      const marks = [
        display.focused ? 'focused' : '',
        display.primary ? 'primary' : '',
        display.blocked === undefined ? '' : `blocked by ${refusalWording(display.blocked)}`,
      ].filter(Boolean);
      // The ordinal is the label drawn in that corner of the composite; the id is what
      // the tools take. Both on one line, because the pet has to map one to the other.
      return `${index + 1}: id ${display.id}, ${width}x${height} at ${x},${y}${
        marks.length > 0 ? ` (${marks.join(', ')})` : ''
      }`;
    });

    return {
      content: [
        `${displays.length} display${displays.length === 1 ? '' : 's'}. The number before each ` +
          `is the label drawn in that corner of the composite; the id is what ` +
          `${LOOK_AT_DISPLAY} and ${LOOK_CLOSER} take.`,
        ...lines,
      ].join('\n'),
    };
  } catch (error) {
    return hostFailure(error);
  }
}

function displayIdOf(input: unknown): number | undefined {
  const id = (input as { displayId?: unknown } | undefined)?.displayId;
  return typeof id === 'number' && Number.isFinite(id) ? id : undefined;
}

export async function runLookAtDisplay(context: FullViewContext, input: unknown): Promise<Outcome> {
  const displayId = displayIdOf(input);
  if (displayId === undefined) {
    return { content: `${LOOK_AT_DISPLAY} needs a numeric displayId.`, isError: true };
  }

  try {
    const displays = await context.displays();
    if (displays === undefined) return noHost('photograph a display');

    const display = displays.find((candidate) => candidate.id === displayId);
    if (display === undefined) {
      // Naming the ids that do exist, so the model corrects itself in one turn rather
      // than guessing again at the same wrong number.
      const known = displays.map((candidate) => candidate.id).join(', ');
      return {
        content: `There is no display ${displayId}. The displays are: ${known || 'none'}.`,
        isError: true,
      };
    }
    if (display.blocked !== undefined) {
      return {
        content:
          `Display ${displayId} is blocked: a window on it matches ` +
          `${refusalWording(display.blocked)}. Nothing was captured. Tell the user Tagalong ` +
          `cannot look at that screen, and do not guess what is on it.`,
        isError: true,
      };
    }
    if (display.image === undefined) {
      return {
        content: `The host returned no picture of display ${displayId}. Tell the user that.`,
        isError: true,
      };
    }

    const { width, height, mime, base64 } = display.image;
    if (!context.vision()) {
      return {
        content:
          `Captured display ${displayId}: PNG, ${width}x${height}. This pet cannot look at ` +
          `images, so you have not seen it. Tell the user that and do not guess what is on ` +
          `that screen.`,
      };
    }
    return {
      content: [
        { type: 'image', mime, base64 },
        { type: 'text', text: `Display ${displayId}, ${width}x${height}.` },
      ],
    };
  } catch (error) {
    return hostFailure(error);
  }
}

function rectOf(input: unknown): DisplayBounds | undefined {
  const rect = (input as { rect?: Record<string, unknown> } | undefined)?.rect;
  if (rect === undefined) return undefined;
  const values = [rect['x'], rect['y'], rect['width'], rect['height']];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return undefined;
  }
  const [x, y, width, height] = values as [number, number, number, number];
  return { x, y, width, height };
}

export async function runLookCloser(context: FullViewContext, input: unknown): Promise<Outcome> {
  const displayId = displayIdOf(input);
  const rect = rectOf(input);
  if (displayId === undefined || rect === undefined) {
    return {
      content: `${LOOK_CLOSER} needs a numeric displayId and a rect of x, y, width and height.`,
      isError: true,
    };
  }
  if (rect.width <= 0 || rect.height <= 0) {
    // Refused here rather than at the host: a zero-area crop is a model mistake, and the
    // round trip would spend a real capture to come back with a picture of nothing.
    return {
      content: `A crop needs a positive width and height; got ${rect.width}x${rect.height}.`,
      isError: true,
    };
  }

  const host = context.host('displays', 'captureRegion');
  if (host === undefined) return noHost('crop part of a display');

  try {
    const { image } = await host.captureRegion({ displayId, rect, maxLongSide: CROP_LONG_SIDE });
    if (!context.vision()) {
      return {
        content:
          `Cropped ${rect.width}x${rect.height} from display ${displayId}: PNG, ${image.width}x` +
          `${image.height}. This pet cannot look at images, so you have not seen it. Tell the ` +
          `user that and do not guess what it shows.`,
      };
    }
    return {
      content: [
        { type: 'image', mime: image.mime, base64: image.base64 },
        {
          type: 'text',
          text: `Display ${displayId} at ${rect.x},${rect.y}, ${image.width}x${image.height}.`,
        },
      ],
    };
  } catch (error) {
    return hostFailure(error);
  }
}

export async function runListWindows(context: FullViewContext): Promise<Outcome> {
  const host = context.host('displays', 'listWindows');
  if (host === undefined) return noHost('enumerate the open windows');

  try {
    // renderInventory is the same text the prompt already carries, so what the pet sees
    // through this tool and what it was handed up front cannot drift into two dialects.
    return { content: renderInventory((await host.listWindows()).windows) };
  } catch (error) {
    return hostFailure(error);
  }
}

export async function runReadWindowText(
  context: FullViewContext,
  input: unknown,
): Promise<Outcome> {
  const asked = (input ?? {}) as { windowId?: unknown; maxChars?: unknown };
  const windowId = typeof asked.windowId === 'string' ? asked.windowId : undefined;
  const maxChars =
    typeof asked.maxChars === 'number' && Number.isFinite(asked.maxChars) && asked.maxChars > 0
      ? Math.floor(asked.maxChars)
      : context.windowTextBudget();

  const host = context.host('textLayer', 'readText');
  if (host === undefined) return noHost('read the text of a window');

  try {
    const reading = await host.readText({
      ...(windowId === undefined ? {} : { windowId }),
      maxChars,
    });

    if (reading.blocked !== undefined) {
      return {
        content:
          `That window is blocked: it matches ${refusalWording(reading.blocked)}. Nothing was ` +
          `read. Tell the user Tagalong cannot read that window, and do not guess what is in it.`,
        isError: true,
      };
    }

    const header = [`Text of window ${reading.windowId}`];
    if (reading.truncated) {
      header.push(
        `(truncated at ${maxChars} characters, so this is the start of the window and not all of it)`,
      );
    }
    if (reading.source === 'ocr') {
      header.push('(read from pixels, so it may contain recognition errors)');
    }

    // The notes ride as their own paragraph rather than folded into the text, so the pet
    // cannot quote a caveat back to the user as something that was on their screen.
    const notes = reading.notes ?? [];
    return {
      content: [
        header.join(' '),
        ...(notes.length > 0 ? [notes.join(' ')] : []),
        ...(reading.text.length > 0 ? ['', reading.text] : []),
      ].join('\n'),
    };
  } catch (error) {
    return hostFailure(error);
  }
}
