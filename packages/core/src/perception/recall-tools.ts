import type {
  HostCapability,
  PerceptionDiffParams,
  PerceptionDiffResult,
  PerceptionRecallParams,
  PerceptionRecallResult,
} from '@tagalong/protocol';
import type { BrainContentBlock } from '../providers';
import { renderInventory } from './inventory';

/**
 * The Phase 3B pair: what the screen looked like a while ago, and what changed since.
 *
 * Kept apart from the full-view tools for the same reason those were split from the
 * Phase 2 pair: these share a spine the others do not — a moment in time, which every
 * answer names so the pet can tell the user which moment it is describing.
 */

export const RECALL_SCREEN = 'recall_screen';
export const WHAT_CHANGED = 'what_changed';

/** A gap this small between the moment asked for and the frame found is just tick spacing. */
const TICK_SLACK_SECONDS = 10;

export interface RecallMethods {
  recall(params: PerceptionRecallParams): Promise<PerceptionRecallResult>;
  diff(params: PerceptionDiffParams): Promise<PerceptionDiffResult>;
}

export interface RecallContext {
  host<K extends keyof RecallMethods>(
    capability: HostCapability,
    method: K,
  ): Pick<RecallMethods, K> | undefined;
  vision(): boolean;
  now(): number;
}

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

function hostFailure(error: unknown): Outcome {
  const message = error instanceof Error ? error.message : String(error);
  return { content: `The host could not answer: ${message}`, isError: true };
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

export async function runRecallScreen(context: RecallContext, input: unknown): Promise<Outcome> {
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
          'they can turn it on in Settings, under Awareness, and that it starts from then.',
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

export async function runWhatChanged(context: RecallContext, input: unknown): Promise<Outcome> {
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
        `${displayId}. With rolling memory on (Settings, Awareness) it keeps the last few ` +
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
