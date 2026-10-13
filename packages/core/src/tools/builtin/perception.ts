import { DEFAULT_WINDOW_TEXT_CHARS } from '@tagalong/protocol';
import type {
  CaptureExclusions,
  ContextSnapshotPatch,
  DisplayBounds,
  DisplaySnapshot,
  HostCapability,
} from '@tagalong/protocol';
import type { BrainContentBlock, BrainTool } from '../../providers';
import { captureSelection } from '../../perception/browser-route';
import {
  findCaptureBlock,
  type ActiveWindow,
  type CaptureBlock,
} from '../../perception/exclusions';
import type { PerceptionHost } from '../../perception/host';
import { renderInventory } from '../../perception/inventory';
import { defineTool, type Tool, type ToolContext, type ToolOutcome } from '../tool';

/**
 * The perception tools: what is on screen now. Seven tools, all `read`.
 *
 * Two spines live here. The Phase 2 pair (`look_at_screen`, `get_selection`) share the
 * capture path: ask what the focused window is, check the exclusion list, then capture.
 * The Phase 2B five share a display id or a window id, fetched from a listing the pet is
 * told to call first.
 */

/** Tool names, as the model sees them. */
export const LOOK_AT_SCREEN = 'look_at_screen';
export const GET_SELECTION = 'get_selection';
export const LIST_DISPLAYS = 'list_displays';
export const LOOK_AT_DISPLAY = 'look_at_display';
export const LOOK_CLOSER = 'look_closer';
export const LIST_WINDOWS = 'list_windows';
export const READ_WINDOW_TEXT = 'read_window_text';
export const LOOK_AT_WINDOW = 'look_at_window';

/** What the perception and recall tools need from the engine. */
export interface PerceptionToolsOptions {
  /** Called per tool use: hosts connect and drop while a conversation is in flight. */
  hosts: () => readonly PerceptionHost[];
  /** Called per tool use too, so editing the exclusion list takes effect immediately. */
  exclusions: () => CaptureExclusions;
  /**
   * A ceiling on sight. Called per tool use because the user can switch providers
   * mid-conversation. The turn's own `vision` can lower it but never raise it; with this
   * absent, the turn alone decides.
   *
   * Absent with no turn vision either means *no* vision: handing base64 to a model that
   * cannot decode it burns the user's tokens and teaches it nothing, so the safe default
   * is words.
   */
  vision?: () => boolean;
  /**
   * The user's default character cap for one window text read.
   *
   * A function, and called per tool use, for the same reason `exclusions` is: this is
   * edited in Settings while the app runs, and a value captured at boot would be a
   * control that silently does nothing until the next launch.
   *
   * Absent means the shipped default. A pet that names its own `maxChars` still wins —
   * asking for less than the budget is the pet spending carefully, not overriding the
   * user.
   */
  windowTextBudget?: () => number;
  /** Phase 3B. Milliseconds since the epoch; injected so recall wording is testable. */
  now?: () => number;
}

/**
 * Whether this call may return pixels: the turn's sight, under the options' ceiling.
 * Pets pick their own provider and model, so only the turn knows whether the brain asking
 * can decode an image; the options' `vision` stays a ceiling a turn can lower but never raise.
 */
export function canSee(options: PerceptionToolsOptions, ctx: ToolContext): boolean {
  const ceiling = options.vision?.();
  if (ceiling === undefined) return ctx.vision ?? false;
  return ceiling && (ctx.vision ?? true);
}

/** Neither Phase 2 tool takes arguments: "look at the screen" has nothing to parameterise. */
const NO_INPUT: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const LOOK_AT_SCREEN_DEFINITION: BrainTool = {
  name: LOOK_AT_SCREEN,
  description:
    'Take a screenshot of the window the user is looking at right now. Use it when the ' +
    'user points at something on screen — "this", "here", "that error" — and no ' +
    'screenshot came with their message. The user sees every capture, and windows on ' +
    'their exclusion list refuse it.',
  inputSchema: NO_INPUT,
};

const GET_SELECTION_DEFINITION: BrainTool = {
  name: GET_SELECTION,
  description:
    'Read the text the user currently has selected, in whatever application has focus. ' +
    'Use it when the user asks about "this" text and no selection came with their ' +
    'message. Returns a plain statement when nothing is selected.',
  inputSchema: NO_INPUT,
};

const LIST_DISPLAYS_DEFINITION: BrainTool = {
  name: LIST_DISPLAYS,
  description:
    'List the monitors attached to this machine: id, size, position and which one the ' +
    'user is working on. No pictures, so it is cheap. Call it before look_at_display ' +
    'or look_closer, which both need a display id from here.',
  inputSchema: NO_INPUT,
};

const LOOK_AT_DISPLAY_DEFINITION: BrainTool = {
  name: LOOK_AT_DISPLAY,
  description:
    'Take a picture of one whole monitor, named by its id from list_displays. Use it ' +
    'when the user asks about a screen you were not given an image of. For anything ' +
    `textual prefer ${READ_WINDOW_TEXT}: it is exact and far cheaper than a picture.`,
  inputSchema: {
    type: 'object',
    properties: {
      displayId: { type: 'number', description: 'A display id from list_displays.' },
    },
    required: ['displayId'],
    additionalProperties: false,
  },
};

const LOOK_CLOSER_DEFINITION: BrainTool = {
  name: LOOK_CLOSER,
  description:
    'Take a native-resolution picture of one rectangle of a monitor, for when a whole ' +
    'screen is too coarse to make something out. Use it only when layout, a chart or ' +
    `an image is what matters. Never use it to read text — ${READ_WINDOW_TEXT} returns ` +
    'text exactly, while a picture makes you guess at it and costs far more.',
  inputSchema: {
    type: 'object',
    properties: {
      displayId: { type: 'number', description: 'A display id from list_displays.' },
      rect: {
        type: 'object',
        description: "The rectangle to crop, in that display's own pixels.",
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
        required: ['x', 'y', 'width', 'height'],
        additionalProperties: false,
      },
    },
    required: ['displayId', 'rect'],
    additionalProperties: false,
  },
};

const LIST_WINDOWS_DEFINITION: BrainTool = {
  name: LIST_WINDOWS,
  description:
    'List every open window — what it is, which monitor it is on, whether it is in ' +
    'front, behind something else or minimized, and roughly how much readable text it ' +
    'holds. No window contents, so it is cheap. This is how you find the window you ' +
    `want before calling ${READ_WINDOW_TEXT} on it, including windows the user cannot ` +
    'see right now.',
  inputSchema: NO_INPUT,
};

const READ_WINDOW_TEXT_DEFINITION: BrainTool = {
  name: READ_WINDOW_TEXT,
  description:
    'Read the text of one window, named by its id. Works on a window behind another ' +
    `and on a minimized one. Call ${LIST_WINDOWS} first and name the single window you ` +
    'need; there is no way to read them all at once, and asking for the wrong one ' +
    'costs the user tokens for nothing. Editors and terminals draw their own text, so ' +
    'for those the text is read from a picture of the window instead: it covers only ' +
    'what is on screen and words may be misread. A short result may mean you could not ' +
    'read inside the window rather than that it is empty. The result says so when that ' +
    'happens; repeat it rather than guessing.',
  inputSchema: {
    type: 'object',
    properties: {
      windowId: {
        type: 'string',
        description: 'A window id from list_windows. Omit to read the window in front.',
      },
      maxChars: {
        type: 'number',
        description:
          'How much text to return at most. Omit it to use the budget the user set ' +
          'in Settings; ask for less when you only need the top of a window.',
      },
    },
    additionalProperties: false,
  },
};

const LOOK_AT_WINDOW_DEFINITION: BrainTool = {
  name: LOOK_AT_WINDOW,
  description:
    'Take a screenshot of one window, named by its id from list_windows, even when it is ' +
    `behind other windows. Use it when the picture matters; for text prefer ` +
    `${READ_WINDOW_TEXT}, which is exact and far cheaper. A minimized window has nothing ` +
    'to photograph, and blind spots refuse it; the result says so.',
  inputSchema: {
    type: 'object',
    properties: {
      windowId: { type: 'string', description: 'A window id from list_windows.' },
    },
    required: ['windowId'],
    additionalProperties: false,
  },
};

/**
 * The eight perception tools, bound to whatever hosts are connected.
 *
 * `look_at_screen` hands back the captured PNG as an image block, because a model that
 * asked to look has to end up with pixels — a sentence saying "PNG, 640×480" is the one
 * answer that reads as sight but conveys none. Everything else stays text: a snapshot
 * object would teach a model nothing, and `get_selection` already returns the selected
 * text itself, which is the part a model can reason about.
 */
export function perceptionTools(options: PerceptionToolsOptions): Tool[] {
  const fullView = (ctx: ToolContext): FullViewContext =>
    fullViewContext(options, canSee(options, ctx));
  return [
    defineTool(LOOK_AT_SCREEN_DEFINITION, 'read', (_input, ctx) =>
      capture(options, canSee(options, ctx)),
    ),
    defineTool(GET_SELECTION_DEFINITION, 'read', () => selection(options)),
    defineTool(LIST_DISPLAYS_DEFINITION, 'read', (_input, ctx) => runListDisplays(fullView(ctx))),
    defineTool(LOOK_AT_DISPLAY_DEFINITION, 'read', (input, ctx) =>
      runLookAtDisplay(fullView(ctx), input),
    ),
    defineTool(LOOK_CLOSER_DEFINITION, 'read', (input, ctx) => runLookCloser(fullView(ctx), input)),
    defineTool(LIST_WINDOWS_DEFINITION, 'read', (_input, ctx) => runListWindows(fullView(ctx))),
    defineTool(READ_WINDOW_TEXT_DEFINITION, 'read', (input, ctx) =>
      runReadWindowText(fullView(ctx), input),
    ),
    defineTool(LOOK_AT_WINDOW_DEFINITION, 'read', (input, ctx) =>
      runLookAtWindow(fullView(ctx), input),
    ),
  ];
}

// ---------------------------------------------------------------------------------------
// The Phase 2 pair: look_at_screen and get_selection.

async function capture(options: PerceptionToolsOptions, vision: boolean): Promise<ToolOutcome> {
  const target = 'screenshot';
  const host = options.hosts().find((candidate) => candidate.capabilities.includes(target));
  if (host === undefined) {
    return {
      content:
        'No connected host can take a screenshot, so you cannot look at the screen right now. Tell the user that.',
      isError: true,
    };
  }

  try {
    // Ask what the focused window is *before* asking for its contents: an exclusion that
    // only filters the answer has already taken the screenshot it promised not to take.
    const identity = host.capabilities.includes('activeWindow')
      ? await host.capture(['activeWindow'])
      : {};
    const block = findCaptureBlock(toActiveWindow(identity), options.exclusions());
    if (block !== null) return { content: refusal(block), isError: true };

    const patch = await host.capture([target]);
    return { content: describe(target, patch, identity.app, vision) };
  } catch (error) {
    // A host that cannot answer — disconnected, timed out, or broken — has to surface as
    // a tool result. Rethrowing would abort the whole turn over a failed glance.
    const message = error instanceof Error ? error.message : String(error);
    return { content: `The host could not complete the capture: ${message}`, isError: true };
  }
}

/**
 * `get_selection`, routed: in a browser the extension reads the DOM selection exactly, and
 * the desktop's clipboard trick is the fallback. See `captureSelection` for the rules.
 */
async function selection(options: PerceptionToolsOptions): Promise<ToolOutcome> {
  try {
    const read = await captureSelection({
      hosts: options.hosts(),
      exclusions: options.exclusions(),
    });
    if (read === null) {
      return {
        content:
          'No connected host can read the selection, so you cannot see what is selected. Tell the user that.',
        isError: true,
      };
    }
    if ('blocked' in read) return { content: refusal(read.blocked), isError: true };
    return {
      content: describe(
        'selection',
        read.selection === undefined ? {} : { selection: read.selection },
        read.app,
        false,
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: `The host could not complete the capture: ${message}`, isError: true };
  }
}

type SnapshotApp = NonNullable<ContextSnapshotPatch['app']>;

function toActiveWindow(patch: ContextSnapshotPatch): ActiveWindow | undefined {
  const app = patch.app;
  if (app === undefined) return undefined;
  return {
    processName: app.name,
    ...(app.windowTitle === undefined ? {} : { title: app.windowTitle }),
  };
}

/**
 * Says which entry blocked the capture, not just that something did. The pet has to be
 * able to tell the user "Tagalong is set not to look at 1Password" — a bare refusal
 * reads as a bug, and a silent empty result reads as the pet ignoring the question.
 */
function refusal(block: CaptureBlock): string {
  const how = block.rule === 'processName' ? 'application' : 'window title pattern';
  return (
    `Capture is blocked here: the active window matches the ${how} '${block.entry}' on the ` +
    "user's capture exclusion list. Nothing was captured. Tell the user Tagalong cannot " +
    'look at this window, and do not guess what is on it.'
  );
}

function describe(
  target: 'screenshot' | 'selection',
  patch: ContextSnapshotPatch,
  app: SnapshotApp | undefined,
  vision: boolean,
): string | BrainContentBlock[] {
  const where = windowLabel(app ?? patch.app);
  if (target === 'selection') {
    const selection = patch.selection?.trim();
    if (!selection) return `Nothing is selected${where ? ` in ${where}` : ''} right now.`;
    return [`Selected text${where ? ` in ${where}` : ''}:`, selection].join('\n');
  }

  const shot = patch.screenshot;
  if (!shot) return `The host returned no screenshot${where ? ` for ${where}` : ''}.`;

  if (vision) {
    // The label rides alongside the pixels because the image alone does not say which
    // window it is; the provider is free to reorder the two.
    return [
      { type: 'image', mime: shot.mime, base64: shot.base64 },
      {
        type: 'text',
        text: `Screenshot${where ? ` of ${where}` : ''}, ${shot.width}×${shot.height}.`,
      },
    ];
  }

  // Told plainly, so the pet can say "I can't see images" instead of narrating a picture
  // it never received. A blind guess about the user's screen is worse than an admission.
  return (
    `Captured a screenshot${where ? ` of ${where}` : ''}: PNG, ${shot.width}×${shot.height}. ` +
    'This pet cannot look at images, so you have not seen it. Tell the user that and do ' +
    'not guess what is on screen.'
  );
}

function windowLabel(app: SnapshotApp | undefined): string {
  if (app === undefined) return '';
  return app.windowTitle ? `${app.name} — ${app.windowTitle}` : app.name;
}

// ---------------------------------------------------------------------------------------
// The Phase 2B five: every display, and any window by name.

/** How large a `look_closer` crop may come back. The same ceiling as every other image. */
const CROP_LONG_SIDE = 1568;

/** What the full-view tools need from the options, bound per tool use. */
interface FullViewContext {
  displays(): Promise<readonly DisplaySnapshot[] | undefined>;
  host<K extends 'captureRegion' | 'listWindows' | 'readText' | 'captureWindow'>(
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

interface FullViewMethods {
  captureRegion(params: CaptureRegionParams): Promise<{ image: CapturedImageLike }>;
  listWindows(): Promise<{ windows: readonly WindowEntryLike[] }>;
  readText(params: { windowId?: string; maxChars: number }): Promise<ReadingLike>;
  captureWindow(params: { windowId: string; maxLongSide: number }): Promise<{
    windowId: string;
    image?: CapturedImageLike;
    blocked?: CaptureBlock;
    notes?: string[];
  }>;
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
 * Binds the full-view tools to whatever hosts are connected right now.
 *
 * Built per tool use: hosts connect and drop while a conversation is in flight, so a
 * context captured once would outlive the socket it describes.
 */
function fullViewContext(options: PerceptionToolsOptions, vision: boolean): FullViewContext {
  return {
    vision: () => vision,

    // Absent means the shipped default, which is what a host that never wired settings
    // through gets — the same fallback the schema uses, so the two cannot disagree.
    windowTextBudget: () => options.windowTextBudget?.() ?? DEFAULT_WINDOW_TEXT_CHARS,

    async displays(): Promise<readonly DisplaySnapshot[] | undefined> {
      const host = options.hosts().find((candidate) => candidate.capabilities.includes('displays'));
      if (host === undefined) return undefined;
      return (await host.capture(['displays'])).displays ?? [];
    },

    /**
     * Requires both halves: the capability the host advertises, and the method it
     * actually implements.
     *
     * A host claiming `displays` with no `listWindows` is a wiring mistake, and this
     * phase has shipped that exact shape twice — an unanswered method reads to the user
     * as a pet that ignored them. Checking the method here turns it into a refusal the
     * pet can repeat instead of an exception that ends the turn.
     */
    host<K extends 'captureRegion' | 'listWindows' | 'readText' | 'captureWindow'>(
      capability: HostCapability,
      method: K,
    ) {
      const found = options
        .hosts()
        .find(
          (candidate: PerceptionHost) =>
            candidate.capabilities.includes(capability) && typeof candidate[method] === 'function',
        );
      return found as ReturnType<FullViewContext['host']> | undefined;
    },
  };
}

export function noHost(what: string): ToolOutcome {
  return {
    content: `No connected host can ${what} right now. Tell the user that rather than guessing.`,
    isError: true,
  };
}

/** A host that cannot answer surfaces as a tool result; throwing would kill the turn. */
export function hostFailure(error: unknown): ToolOutcome {
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

async function runListDisplays(context: FullViewContext): Promise<ToolOutcome> {
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

async function runLookAtDisplay(context: FullViewContext, input: unknown): Promise<ToolOutcome> {
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

async function runLookCloser(context: FullViewContext, input: unknown): Promise<ToolOutcome> {
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

async function runListWindows(context: FullViewContext): Promise<ToolOutcome> {
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

async function runReadWindowText(context: FullViewContext, input: unknown): Promise<ToolOutcome> {
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

async function runLookAtWindow(context: FullViewContext, input: unknown): Promise<ToolOutcome> {
  const asked = (input ?? {}) as { windowId?: unknown };
  if (typeof asked.windowId !== 'string' || asked.windowId.length === 0) {
    return { content: `Name a window id from ${LIST_WINDOWS}.`, isError: true };
  }

  const host = context.host('displays', 'captureWindow');
  if (host === undefined) return noHost('photograph a window');

  try {
    const shot = await host.captureWindow({
      windowId: asked.windowId,
      maxLongSide: CROP_LONG_SIDE,
    });
    if (shot.image === undefined) {
      const why = (shot.notes ?? []).join(' ') || 'Tagalong could not photograph that window.';
      return { content: why, isError: true };
    }
    if (!context.vision()) {
      return {
        content:
          `Window ${shot.windowId}: PNG, ${shot.image.width}x${shot.image.height}. This pet ` +
          'cannot look at images, so you have not seen it. Tell the user that and do not ' +
          `guess what it shows; ${READ_WINDOW_TEXT} may help.`,
      };
    }
    return {
      content: [
        { type: 'image', mime: shot.image.mime, base64: shot.image.base64 },
        {
          type: 'text',
          text: `Window ${shot.windowId}, ${shot.image.width}x${shot.image.height}.`,
        },
      ],
    };
  } catch (error) {
    return hostFailure(error);
  }
}
