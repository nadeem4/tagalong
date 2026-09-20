import { DEFAULT_WINDOW_TEXT_CHARS } from '@tagalong/protocol';
import type {
  CaptureExclusions,
  ContextSnapshotPatch,
  DisplayBounds,
  HostCapability,
  PerceptionCaptureRegionResult,
  PerceptionListWindowsResult,
  PerceptionReadTextResult,
  PerceptionTarget,
} from '@tagalong/protocol';
import type { BrainContentBlock, BrainTool } from '../providers';
import { findCaptureBlock, type ActiveWindow, type CaptureBlock } from './exclusions';
import { fullViewContext as fullView } from './full-view-context';
import {
  LIST_DISPLAYS,
  LIST_WINDOWS,
  LOOK_AT_DISPLAY,
  LOOK_CLOSER,
  READ_WINDOW_TEXT,
  runListDisplays,
  runListWindows,
  runLookAtDisplay,
  runLookCloser,
  runReadWindowText,
} from './full-view-tools';

/** The two built-ins every pet gets. Named as the model sees them. */
export const LOOK_AT_SCREEN = 'look_at_screen';
export const GET_SELECTION = 'get_selection';

export { LIST_DISPLAYS, LIST_WINDOWS, LOOK_AT_DISPLAY, LOOK_CLOSER, READ_WINDOW_TEXT };

/**
 * The slice of a connected host the tools need.
 *
 * Declared structurally rather than importing `HostSession` so a test can hand in a fake
 * host without standing up a websocket — and so `perception` never depends on `server`.
 */
export interface PerceptionHost {
  readonly capabilities: readonly HostCapability[];
  capture(what: readonly PerceptionTarget[]): Promise<ContextSnapshotPatch>;
  /**
   * The three Phase 2B methods.
   *
   * Optional on the type because a host is free to advertise fewer capabilities — the
   * Chrome host will never enumerate displays — and because the capability array is the
   * real gate. A host advertising `displays` without these is a wiring mistake, and the
   * tools report it as a refusal rather than throwing, so the turn survives it.
   */
  captureRegion?(params: {
    displayId: number;
    rect: DisplayBounds;
    maxLongSide: number;
  }): Promise<PerceptionCaptureRegionResult>;
  listWindows?(): Promise<PerceptionListWindowsResult>;
  readText?(params: { windowId?: string; maxChars: number }): Promise<PerceptionReadTextResult>;
}

export interface PerceptionToolsetOptions {
  /** Called per tool use: hosts connect and drop while a conversation is in flight. */
  hosts: () => readonly PerceptionHost[];
  /** Called per tool use too, so editing the exclusion list takes effect immediately. */
  exclusions: () => CaptureExclusions;
  /**
   * Whether the brain in use can actually see an image. Called per tool use because the
   * user can switch providers mid-conversation.
   *
   * Optional, and absent means *no* vision: handing base64 to a model that cannot decode
   * it burns the user's tokens and teaches it nothing, so the safe default is words.
   */
  vision?: () => boolean;
}

/** Exactly what `BrainEvents.onToolUse` must resolve with. */
export interface ToolOutcome {
  content: string | BrainContentBlock[];
  isError?: boolean;
}

export interface PerceptionToolset {
  readonly definitions: readonly BrainTool[];
  run(call: { name: string; input?: unknown }): Promise<ToolOutcome>;
}

/** Neither tool takes arguments: "look at the screen" has nothing to parameterise. */
const NO_INPUT: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const DEFINITIONS: readonly BrainTool[] = [
  {
    name: LOOK_AT_SCREEN,
    description:
      'Take a screenshot of the window the user is looking at right now. Use it when the ' +
      'user points at something on screen — "this", "here", "that error" — and no ' +
      'screenshot came with their message. The user sees every capture, and windows on ' +
      'their exclusion list refuse it.',
    inputSchema: NO_INPUT,
  },
  {
    name: GET_SELECTION,
    description:
      'Read the text the user currently has selected, in whatever application has focus. ' +
      'Use it when the user asks about "this" text and no selection came with their ' +
      'message. Returns a plain statement when nothing is selected.',
    inputSchema: NO_INPUT,
  },
  {
    name: LIST_DISPLAYS,
    description:
      'List the monitors attached to this machine: id, size, position and which one the ' +
      'user is working on. No pictures, so it is cheap. Call it before look_at_display ' +
      'or look_closer, which both need a display id from here.',
    inputSchema: NO_INPUT,
  },
  {
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
  },
  {
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
  },
  {
    name: LIST_WINDOWS,
    description:
      'List every open window — what it is, which monitor it is on, whether it is in ' +
      'front, behind something else or minimized, and roughly how much readable text it ' +
      'holds. No window contents, so it is cheap. This is how you find the window you ' +
      `want before calling ${READ_WINDOW_TEXT} on it, including windows the user cannot ` +
      'see right now.',
    inputSchema: NO_INPUT,
  },
  {
    name: READ_WINDOW_TEXT,
    description:
      'Read the text of one window, named by its id. Works on a window behind another ' +
      `and on a minimized one. Call ${LIST_WINDOWS} first and name the single window you ` +
      'need; there is no way to read them all at once, and asking for the wrong one ' +
      'costs the user tokens for nothing. Some applications — editors, terminals, ' +
      'drawing tools — draw their own text and publish almost none of it, so a short ' +
      'result may mean you could not read inside the window rather than that it is ' +
      'empty. The result says so when that happens; repeat it rather than guessing.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'string',
          description: 'A window id from list_windows. Omit to read the window in front.',
        },
        maxChars: {
          type: 'number',
          description: `How much text to return at most. Defaults to ${DEFAULT_WINDOW_TEXT_CHARS}.`,
        },
      },
      additionalProperties: false,
    },
  },
];

/**
 * The built-in perception tools, bound to whatever hosts are connected.
 *
 * `look_at_screen` hands back the captured PNG as an image block, because a model that
 * asked to look has to end up with pixels — a sentence saying "PNG, 640×480" is the one
 * answer that reads as sight but conveys none. Everything else stays text: a snapshot
 * object would teach a model nothing, and `get_selection` already returns the selected
 * text itself, which is the part a model can reason about.
 */
export function createPerceptionToolset(options: PerceptionToolsetOptions): PerceptionToolset {
  return {
    definitions: DEFINITIONS,
    run(call): Promise<ToolOutcome> {
      switch (call.name) {
        case LOOK_AT_SCREEN:
          return capture(options, 'screenshot');
        case GET_SELECTION:
          return capture(options, 'selection');
        case LIST_DISPLAYS:
          return runListDisplays(fullView(options));
        case LOOK_AT_DISPLAY:
          return runLookAtDisplay(fullView(options), call.input);
        case LOOK_CLOSER:
          return runLookCloser(fullView(options), call.input);
        case LIST_WINDOWS:
          return runListWindows(fullView(options));
        case READ_WINDOW_TEXT:
          return runReadWindowText(fullView(options), call.input);
        default:
          // Named back so the model can correct itself instead of retrying blindly.
          return Promise.resolve({
            content: `'${call.name}' is not a tool Tagalong provides.`,
            isError: true,
          });
      }
    },
  };
}

async function capture(
  options: PerceptionToolsetOptions,
  target: 'screenshot' | 'selection',
): Promise<ToolOutcome> {
  const host = options.hosts().find((candidate) => candidate.capabilities.includes(target));
  if (host === undefined) {
    return {
      content:
        target === 'screenshot'
          ? 'No connected host can take a screenshot, so you cannot look at the screen right now. Tell the user that.'
          : 'No connected host can read the selection, so you cannot see what is selected. Tell the user that.',
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
    return { content: describe(target, patch, identity.app, options.vision?.() ?? false) };
  } catch (error) {
    // A host that cannot answer — disconnected, timed out, or broken — has to surface as
    // a tool result. Rethrowing would abort the whole turn over a failed glance.
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
