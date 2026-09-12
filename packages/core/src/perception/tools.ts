import type {
  CaptureExclusions,
  ContextSnapshotPatch,
  HostCapability,
  PerceptionTarget,
} from '@tagalong/protocol';
import type { BrainContentBlock, BrainTool } from '../providers';
import { findCaptureBlock, type ActiveWindow, type CaptureBlock } from './exclusions';

/** The two built-ins every pet gets. Named as the model sees them. */
export const LOOK_AT_SCREEN = 'look_at_screen';
export const GET_SELECTION = 'get_selection';

/**
 * The slice of a connected host the tools need.
 *
 * Declared structurally rather than importing `HostSession` so a test can hand in a fake
 * host without standing up a websocket — and so `perception` never depends on `server`.
 */
export interface PerceptionHost {
  readonly capabilities: readonly HostCapability[];
  capture(what: readonly PerceptionTarget[]): Promise<ContextSnapshotPatch>;
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
