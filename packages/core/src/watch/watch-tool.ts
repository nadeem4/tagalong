import type { DisplayBounds } from '@tagalong/protocol';
import type { BrainTool } from '../providers';
import type { CrewTool } from '../conversation/crew-tools';
import type { PerceptionHost, ToolOutcome } from '../perception';
import type { WatchManager } from './watch-manager';

export const WATCH_FOR = 'watch_for';

const DEFINITION: BrainTool = {
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
export function watchTool(deps: WatchToolDeps): CrewTool {
  return {
    definition: DEFINITION,
    async run(input, turn): Promise<ToolOutcome> {
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
        pet: turn.pet,
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
    },
  };
}
