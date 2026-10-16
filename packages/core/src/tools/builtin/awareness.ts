/**
 * The awareness tools: the screen over time. `recall_screen` and `what_changed` look back
 * (`read`); `watch_for` starts a watch that outlives the turn (`write`).
 *
 * The recall pair share a spine the perception tools do not: a moment in time, which
 * every answer names so the pet can tell the user which moment it is describing.
 *
 * Contains `recallTools`, `watchForTool` and `ago`.
 */
import type {
  DisplayBounds,
  HostCapability,
  PerceptionDiffParams,
  PerceptionDiffResult,
  PerceptionRecallParams,
  PerceptionRecallResult,
} from '@tagalong/protocol';
import type { BrainContentBlock, BrainTool } from '../../providers';
import type { PerceptionHost } from '../../perception/host';
import { renderInventory } from '../../perception/inventory';
import type { WatchManager } from '../../watch/watch-manager';
import { defineTool, type Tool, type ToolOutcome } from '../tool';
import { canSee, hostFailure, noHost, type PerceptionToolsOptions } from './perception';

export const RECALL_SCREEN = 'recall_screen';
export const WHAT_CHANGED = 'what_changed';
export const WATCH_FOR = 'watch_for';

/** A gap this small between the moment asked for and the frame found is just tick spacing. */
const TICK_SLACK_SECONDS = 10;

const RECALL_SCREEN_DEFINITION: BrainTool = {
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
};

const WHAT_CHANGED_DEFINITION: BrainTool = {
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
};

const WATCH_FOR_DEFINITION: BrainTool = {
  name: WATCH_FOR,
  description:
    'Keep an eye on the screen and tell the user when a condition comes true — "tell me ' +
    'when this build finishes", "let me know when the download is done". Tagalong compares ' +
    'the screen locally every few seconds and only asks a small model when something ' +
    'changed, so it is cheap to leave running. Without a displayId it watches the display ' +
    'of the window in front. Say you are watching and end your turn: the user is shown the ' +
    'moment it happens, and can stop the watch from its Watching chip.',
  inputSchema: {
    type: 'object',
    properties: {
      condition: {
        type: 'string',
        description: 'What to look for, in plain words: "the build has finished".',
      },
      displayId: {
        type: 'number',
        description: 'A display id from list_displays. Omit to watch the one in front.',
      },
      rect: {
        type: 'object',
        description: "Only this rectangle of the display, in that display's own pixels.",
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
        required: ['x', 'y', 'width', 'height'],
        additionalProperties: false,
      },
      timeoutMinutes: {
        type: 'number',
        description: 'Give up after this long. Omit for the default the user set.',
      },
    },
    required: ['condition'],
    additionalProperties: false,
  },
};

// recall_screen and what_changed.

interface RecallMethods {
  recall(params: PerceptionRecallParams): Promise<PerceptionRecallResult>;
  diff(params: PerceptionDiffParams): Promise<PerceptionDiffResult>;
}

interface RecallContext {
  host<K extends keyof RecallMethods>(
    capability: HostCapability,
    method: K,
  ): Pick<RecallMethods, K> | undefined;
  vision(): boolean;
  now(): number;
}

/** The two recall tools, bound to whichever host advertises `recall` and implements it. */
export function recallTools(options: PerceptionToolsOptions): Tool[] {
  const context = (vision: boolean): RecallContext => ({
    vision: () => vision,
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
  });
  return [
    defineTool(RECALL_SCREEN_DEFINITION, 'read', (input, ctx) =>
      runRecallScreen(context(canSee(options, ctx)), input),
    ),
    defineTool(WHAT_CHANGED_DEFINITION, 'read', (input, ctx) =>
      runWhatChanged(context(canSee(options, ctx)), input),
    ),
  ];
}

function wholeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

/** "45 seconds ago", "5 minutes ago": what a person says, not a timestamp alone. */
export function ago(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}

function reach(seconds: number): string {
  return ago(seconds).replace(/ ago$/, '');
}

function secondsBefore(now: number, iso: string): number {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
}

async function runRecallScreen(context: RecallContext, input: unknown): Promise<ToolOutcome> {
  const asked = (input ?? {}) as { secondsAgo?: unknown; displayId?: unknown };
  const secondsAgo = wholeNumber(asked.secondsAgo);
  const displayId = wholeNumber(asked.displayId);
  if (secondsAgo === undefined || secondsAgo < 0) {
    return { content: `${RECALL_SCREEN} needs secondsAgo, a number of seconds.`, isError: true };
  }

  const host = context.host('recall', 'recall');
  if (host === undefined) return noHost('remember the screen');

  let result: PerceptionRecallResult;
  try {
    result = await host.recall({
      secondsAgo,
      ...(displayId === undefined ? {} : { displayId }),
    });
  } catch (error) {
    return hostFailure(error);
  }

  if (result.frames.length === 0 || result.capturedAt === undefined) {
    if (!result.recording) {
      return {
        content:
          'Rolling memory is off, so Tagalong remembers nothing of the screen. Tell the user ' +
          'they can turn it on in Settings, under Privacy, and that it starts from then.',
      };
    }
    return {
      content:
        'Rolling memory is on but holds nothing from then yet: it starts empty each time the ' +
        'app starts or sight is paused. Tell the user that rather than guessing.',
    };
  }

  const now = context.now();
  const at = result.capturedAt;
  const actualAgo = secondsBefore(now, at);
  const lines: string[] = [];
  if (actualAgo + TICK_SLACK_SECONDS < secondsAgo) {
    lines.push(
      `Memory only reaches back ${reach(actualAgo)}, so this is the oldest moment it holds, ` +
        `not ${ago(secondsAgo)}. Say so.`,
    );
  }
  lines.push(
    `The screen at ${at} (${ago(actualAgo)}). Name this time when you describe it, and do not ` +
      'present it as what is on screen now.',
  );
  if (result.focusedWindow !== undefined) {
    const { processName, title } = result.focusedWindow;
    lines.push(`In front then: ${processName}${title ? ` — ${title}` : ''}.`);
  }
  if (result.windows.length > 0)
    lines.push('', 'Windows open then:', renderInventory(result.windows));
  const summary = lines.join('\n');

  if (!context.vision()) {
    const pictures = result.frames
      .map((frame) => `display ${frame.displayId}, PNG ${frame.image.width}x${frame.image.height}`)
      .join('; ');
    return {
      content:
        `${summary}\n\nRecalled ${pictures}. This pet cannot look at images, so you have not ` +
        'seen them; answer from the window list and say you could not see the pictures.',
    };
  }

  const content: BrainContentBlock[] = [];
  for (const frame of result.frames) {
    content.push({ type: 'image', mime: frame.image.mime, base64: frame.image.base64 });
    content.push({
      type: 'text',
      text: `Display ${frame.displayId} at ${frame.capturedAt}, ${frame.image.width}x${frame.image.height}.`,
    });
  }
  content.push({ type: 'text', text: summary });
  return { content };
}

async function runWhatChanged(context: RecallContext, input: unknown): Promise<ToolOutcome> {
  const asked = (input ?? {}) as { displayId?: unknown; sinceSeconds?: unknown };
  const displayId = wholeNumber(asked.displayId);
  const sinceSeconds = wholeNumber(asked.sinceSeconds);
  if (displayId === undefined || sinceSeconds === undefined || sinceSeconds <= 0) {
    return {
      content: `${WHAT_CHANGED} needs a displayId and sinceSeconds, a positive number of seconds.`,
      isError: true,
    };
  }

  const host = context.host('recall', 'diff');
  if (host === undefined) return noHost('compare the screen with how it was');

  let diff: PerceptionDiffResult;
  try {
    diff = await host.diff({ displayId, sinceSeconds, includeImages: true });
  } catch (error) {
    return hostFailure(error);
  }

  if (diff.beforeAt === undefined) {
    return {
      content:
        `There is nothing to compare with: Tagalong holds no earlier frame of display ` +
        `${displayId}. With rolling memory on (Settings, Privacy) it keeps the last few ` +
        'minutes. Tell the user that.',
    };
  }

  const span = `between ${diff.beforeAt} and ${diff.afterAt}`;
  if (diff.changeRatio === 0 || diff.bounds === undefined) {
    return { content: `Nothing changed on display ${displayId} ${span}.` };
  }

  const percent = Math.max(1, Math.round(diff.changeRatio * 100));
  const { x, y, width, height } = diff.bounds;
  const summary =
    `About ${percent}% of display ${displayId} changed ${span}, inside the box at ${x},${y} ` +
    `sized ${width}x${height}. Name these times when you describe the change.`;

  if (!context.vision() || (diff.before === undefined && diff.after === undefined)) {
    return {
      content: context.vision()
        ? summary
        : `${summary} This pet cannot look at images, so you have not seen the change itself.`,
    };
  }

  const content: BrainContentBlock[] = [];
  if (diff.before !== undefined) {
    content.push({ type: 'text', text: `Before, at ${diff.beforeAt}:` });
    content.push({ type: 'image', mime: diff.before.mime, base64: diff.before.base64 });
  }
  if (diff.after !== undefined) {
    content.push({ type: 'text', text: `After, at ${diff.afterAt}:` });
    content.push({ type: 'image', mime: diff.after.mime, base64: diff.after.base64 });
  }
  content.push({ type: 'text', text: summary });
  return { content };
}

// watch_for.

export interface WatchToolDeps {
  manager: WatchManager;
  hosts: () => readonly PerceptionHost[];
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function rectOf(value: unknown): DisplayBounds | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const rect = value as Record<string, unknown>;
  const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((key) => number(rect[key]));
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (width <= 0 || height <= 0) return undefined;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** The window in front: its display is the default target, its text the fallback evidence. */
async function frontWindow(
  hosts: readonly PerceptionHost[],
): Promise<{ id: string; displayId?: number | undefined } | undefined> {
  const host = hosts.find(
    (candidate) =>
      candidate.capabilities.includes('displays') && typeof candidate.listWindows === 'function',
  );
  if (host === undefined) return undefined;
  try {
    const { windows } = await host.listWindows!();
    const front = windows.find((window) => window.state === 'foreground');
    return front === undefined ? undefined : { id: front.id, displayId: front.displayId };
  } catch {
    return undefined;
  }
}

/** `watch_for`: starts a watch on behalf of the pet that called it. */
export function watchForTool(deps: WatchToolDeps): Tool {
  return defineTool(WATCH_FOR_DEFINITION, 'write', async (input, ctx): Promise<ToolOutcome> => {
    const asked = (input ?? {}) as Record<string, unknown>;
    const condition = typeof asked['condition'] === 'string' ? asked['condition'].trim() : '';
    if (condition.length === 0) {
      return { content: `${WATCH_FOR} needs a condition to look for.`, isError: true };
    }

    const front = await frontWindow(deps.hosts());
    const named = number(asked['displayId']);
    const displayId = named === undefined ? front?.displayId : Math.round(named);
    if (displayId === undefined) {
      return {
        content: `${WATCH_FOR} could not tell which display to watch. Call list_displays and pass a displayId.`,
        isError: true,
      };
    }
    // The front window's text is only evidence for the display it is on.
    const windowId = front !== undefined && front.displayId === displayId ? front.id : undefined;
    const rect = rectOf(asked['rect']);
    const timeoutMinutes = number(asked['timeoutMinutes']);

    const outcome = await deps.manager.start({
      pet: ctx.pet,
      condition,
      displayId,
      rect,
      windowId,
      timeoutMinutes,
    });
    if (!outcome.ok) return { content: outcome.reason, isError: true };

    return {
      content:
        `Watching display ${displayId}${rect === undefined ? '' : ' (one region of it)'} for ` +
        `"${condition}" — for up to ${outcome.timeoutMinutes} minutes and ${outcome.maxChecks} ` +
        'checks. The user sees a Watching chip with a Stop button and will be shown the moment ' +
        'it happens. Tell them briefly that you are watching, and do not wait for it in this turn.',
    };
  });
}
