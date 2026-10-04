import type {
  CaptureExclusions,
  ContextSnapshotPatch,
  DisplayBounds,
  HostCapability,
  PerceptionCaptureRegionResult,
  PerceptionDiffParams,
  PerceptionDiffResult,
  PerceptionListWindowsResult,
  PerceptionRecallParams,
  PerceptionRecallResult,
  PerceptionReadTextResult,
  PerceptionTarget,
} from '@tagalong/protocol';
import type { BrainContentBlock, BrainTool } from '../providers';
import { captureSelection } from './browser-route';
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
import { RECALL_SCREEN, WHAT_CHANGED, runRecallScreen, runWhatChanged } from './recall-tools';
import type { RecallContext } from './recall-tools';

/** The two built-ins every pet gets. Named as the model sees them. */
export const LOOK_AT_SCREEN = 'look_at_screen';
export const GET_SELECTION = 'get_selection';

export {
  LIST_DISPLAYS,
  LIST_WINDOWS,
  LOOK_AT_DISPLAY,
  LOOK_CLOSER,
  READ_WINDOW_TEXT,
  RECALL_SCREEN,
  WHAT_CHANGED,
};

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
  /** Phase 3B, behind the `recall` capability: a buffered frame from a moment ago. */
  recall?(params: PerceptionRecallParams): Promise<PerceptionRecallResult>;
  /** Phase 3B, behind the `recall` capability: how a display changed since then. */
  diff?(params: PerceptionDiffParams): Promise<PerceptionDiffResult>;
}

export interface PerceptionToolsetOptions {
  /** Called per tool use: hosts connect and drop while a conversation is in flight. */
  hosts: () => readonly PerceptionHost[];
  /** Called per tool use too, so editing the exclusion list takes effect immediately. */
  exclusions: () => CaptureExclusions;
  /**
   * Whether the brain in use can actually see an image. Called per tool use because the
   * user can switch providers mid-conversation. A `ToolTurn` passed to `run` narrows it
   * for that call; with one, absent here means "whatever the turn says".
   *
   * Optional, and absent (with no turn) means *no* vision: handing base64 to a model that cannot decode
   * it burns the user's tokens and teaches it nothing, so the safe default is words.
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

/** Exactly what `BrainEvents.onToolUse` must resolve with. */
export interface ToolOutcome {
  content: string | BrainContentBlock[];
  isError?: boolean;
}

/** What one turn knows that the toolset does not: whether this pet's brain can see. */
export interface ToolTurn {
  vision: boolean;
}

export interface PerceptionToolset {
  readonly definitions: readonly BrainTool[];
  /**
   * `turn` narrows sight for one call. Pets pick their own provider and model, so only
   * the turn knows whether the brain asking can decode an image; the toolset's own
   * `vision` option stays a ceiling a turn can lower but never raise.
   */
  run(call: { name: string; input?: unknown }, turn?: ToolTurn): Promise<ToolOutcome>;
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
          description:
            'How much text to return at most. Omit it to use the budget the user set ' +
            'in Settings; ask for less when you only need the top of a window.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: RECALL_SCREEN,
    description:
      'Look back at the screen as it was a while ago, from rolling memory: a picture of each ' +
      'display and the windows open at that moment. Use it when the user asks what they were ' +
      'doing, reading or looking at earlier — "five minutes ago", "before the meeting". ' +
      'Always state the time of the frame you describe, and never present it as the screen ' +
      'now. Memory is opt-in and holds only the last few minutes; the result says when it is ' +
      'off or does not reach back that far.',
    inputSchema: {
      type: 'object',
      properties: {
        secondsAgo: { type: 'number', description: 'How many seconds back to look.' },
        displayId: {
          type: 'number',
          description: 'One display id from list_displays. Omit for every display.',
        },
      },
      required: ['secondsAgo'],
      additionalProperties: false,
    },
  },
  {
    name: WHAT_CHANGED,
    description:
      'Compare one display now with how it looked some seconds ago and see only the part ' +
      'that changed, before and after, with how much of the screen it was. Use it for ' +
      '"what just happened", "what changed while I was away". State the two times you are ' +
      'comparing.',
    inputSchema: {
      type: 'object',
      properties: {
        displayId: { type: 'number', description: 'A display id from list_displays.' },
        sinceSeconds: { type: 'number', description: 'How many seconds back to compare with.' },
      },
      required: ['displayId', 'sinceSeconds'],
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
export function createPerceptionToolset(base: PerceptionToolsetOptions): PerceptionToolset {
  return {
    definitions: DEFINITIONS,
    run(call, turn): Promise<ToolOutcome> {
      const options =
        turn === undefined
          ? base
          : { ...base, vision: () => turn.vision && (base.vision?.() ?? true) };
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
        case RECALL_SCREEN:
          return runRecallScreen(recallContext(options), call.input);
        case WHAT_CHANGED:
          return runWhatChanged(recallContext(options), call.input);
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

/** Binds the Phase 3B tools to whichever host advertises `recall` and implements the method. */
function recallContext(options: PerceptionToolsetOptions): RecallContext {
  return {
    vision: () => options.vision?.() ?? false,
    now: () => options.now?.() ?? Date.now(),
    host(capability, method) {
      const found = options
        .hosts()
        .find(
          (candidate) =>
            candidate.capabilities.includes(capability) && typeof candidate[method] === 'function',
        );
      return found as ReturnType<RecallContext['host']>;
    },
  };
}

async function capture(
  options: PerceptionToolsetOptions,
  target: 'screenshot' | 'selection',
): Promise<ToolOutcome> {
  if (target === 'selection') return selection(options);
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

/**
 * `get_selection`, routed: in a browser the extension reads the DOM selection exactly, and
 * the desktop's clipboard trick is the fallback. See `captureSelection` for the rules.
 */
async function selection(options: PerceptionToolsetOptions): Promise<ToolOutcome> {
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
