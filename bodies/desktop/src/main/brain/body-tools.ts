/**
 * The desktop's body tools for contract v1: list_windows, read_window_text, look_at_window, open_url.
 * Declared in `hello`, run when the brain sends `use`. Names and descriptions carry over from
 * the old brain's perception tools. Every run is bounded at 15 s, and any capture that
 * reads pixels raises the capture notice, as the old engine host did.
 */
import { ErrorCode, type Part, type Tool } from '@tagalong/contract';
import { DEFAULT_WINDOW_TEXT_CHARS } from '@tagalong/protocol';
import type { CaptureBlock, CaptureExclusions } from '@tagalong/protocol';
import { captureNotice } from '../capture-notice';
import type { CaptureNotice } from '../../shared/ipc';
import type { Platform } from '../platform/index';
import { RpcError } from './brain-client';

const RUN_TIMEOUT_MS = 15_000;
const LONG_SIDE = 1568;
const MINIMIZED = 'That window is minimized, so there is nothing drawn to look at.';

const tools: Tool[] = [
  {
    name: 'list_windows',
    description:
      'List every open window, grouped by screen (numbered 1, 2 as the user sees them), ' +
      'then the minimized ones: what each is, whether it is in front, behind something ' +
      'else or minimized, and roughly how much readable text it holds. No window ' +
      'contents, so it is cheap. This is how you find the window you want before calling ' +
      'read_window_text on it, including windows the user cannot see right now.',
    effect: 'read',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_window_text',
    description:
      'Read the text of one window, named by its id. Works on a window behind another ' +
      'and on a minimized one. Call list_windows first and name the single window you ' +
      'need; there is no way to read them all at once, and asking for the wrong one ' +
      'costs the user tokens for nothing. Editors and terminals draw their own text, so ' +
      'for those the text is read from a picture of the window instead: it covers only ' +
      'what is on screen and words may be misread. A short result may mean you could not ' +
      'read inside the window rather than that it is empty; the result notes when that ' +
      'happens.',
    effect: 'read',
    input_schema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'string',
          description: 'A window id from list_windows. Omit to read the window in front.',
        },
        maxChars: {
          type: 'number',
          description:
            'How much text to return at most. Ask for less when you only need the top of a window.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'look_at_window',
    description:
      'Take a screenshot of one window, named by its id from list_windows, even when it is ' +
      'behind other windows. Use it when the picture matters; for text prefer ' +
      'read_window_text, which is exact and far cheaper. A minimized window has nothing ' +
      'to photograph, and blind spots refuse it; the result says so.',
    effect: 'read',
    input_schema: {
      type: 'object',
      properties: {
        windowId: { type: 'string', description: 'A window id from list_windows.' },
      },
      required: ['windowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_url',
    description:
      'Open a web page in the default browser on this machine. Only https addresses. ' +
      'The brain uses it for sign-in pages.',
    effect: 'change',
    // Locked: no Always allow button, so no click can let Scout open any page an app's text
    // talks it into; only the Home switch unlocks it.
    confirm: true,
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'An https address.' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
];

function failed(message: string): RpcError {
  return new RpcError(ErrorCode.tool_failed, message);
}

function text(value: string): Part[] {
  return [{ type: 'text', text: value }];
}

export function bodyTools(
  platform: Platform,
  exclusions: () => CaptureExclusions,
  onCapture: (notice: CaptureNotice) => void,
  openExternal: (url: string) => Promise<void>,
): { tools: Tool[]; run: (tool: string, input: Record<string, unknown>) => Promise<Part[]> } {
  const announce = (blocked: CaptureBlock | null) =>
    onCapture(captureNotice({ at: new Date(), screenshot: true, blocked, paused: false }));

  async function listWindows(): Promise<Part[]> {
    const { windows, displays } = await platform.listWindows(exclusions());
    return text(JSON.stringify(displays === undefined ? { windows } : { windows, displays }));
  }

  async function readWindowText(input: Record<string, unknown>): Promise<Part[]> {
    const windowId = typeof input['windowId'] === 'string' ? input['windowId'] : undefined;
    const asked = input['maxChars'];
    const maxChars =
      typeof asked === 'number' && Number.isFinite(asked) && asked > 0
        ? Math.floor(asked)
        : DEFAULT_WINDOW_TEXT_CHARS;
    const reading = await platform.readWindowText(
      { ...(windowId === undefined ? {} : { windowId }), maxChars },
      exclusions(),
    );
    if (reading.blocked !== undefined) {
      throw failed(reading.notes?.[0] ?? 'That window is on the capture exclusion list.');
    }
    // Read from a picture means a picture was taken: announced like any screenshot.
    if (reading.source === 'ocr') announce(null);
    // Notes ride as their own paragraph so Scout cannot quote a caveat as screen content.
    const notes = reading.notes ?? [];
    return text(
      [
        `Text of window ${reading.windowId}${reading.truncated ? ` (truncated at ${maxChars} characters)` : ''}`,
        ...(notes.length > 0 ? [notes.join(' ')] : []),
        ...(reading.text.length > 0 ? ['', reading.text] : []),
      ].join('\n'),
    );
  }

  async function lookAtWindow(input: Record<string, unknown>): Promise<Part[]> {
    const windowId = input['windowId'];
    if (typeof windowId !== 'string' || windowId.length === 0) {
      throw new RpcError(ErrorCode.invalid_params, 'windowId is required');
    }
    // Checked here so the refusal is the one sentence Scout is told to repeat.
    const { windows } = await platform.listWindows(exclusions(), { countText: false });
    const target = windows.find((w) => w.id === windowId);
    if (target?.state === 'minimized' && target.blocked === undefined) throw failed(MINIMIZED);

    const shot = await platform.lookAtWindow({ windowId, maxLongSide: LONG_SIDE }, exclusions());
    announce(shot.blocked ?? null);
    if (shot.image === undefined) {
      throw failed((shot.notes ?? []).join(' ') || 'Tagalong could not photograph that window.');
    }
    return [{ type: 'image', mime: shot.image.mime, data: shot.image.base64 }];
  }

  // https only: the address comes from a remote app's sign-in flow, so no http, file: or app
  // schemes may reach the shell.
  async function openUrl(input: Record<string, unknown>): Promise<Part[]> {
    const raw = input['url'];
    let url: URL | undefined;
    try {
      if (typeof raw === 'string') url = new URL(raw);
    } catch {
      url = undefined;
    }
    if (url?.protocol !== 'https:') {
      throw new RpcError(ErrorCode.invalid_params, 'open_url needs an https address');
    }
    await openExternal(url.href);
    return text('Opened in the browser.');
  }

  const handlers: Record<string, (input: Record<string, unknown>) => Promise<Part[]>> = {
    list_windows: listWindows,
    read_window_text: readWindowText,
    look_at_window: lookAtWindow,
    open_url: openUrl,
  };

  async function run(tool: string, input: Record<string, unknown>): Promise<Part[]> {
    const handler = handlers[tool];
    if (handler === undefined) throw new RpcError(ErrorCode.unknown_tool, 'unknown tool');
    // The platform has no abort, so a call may finish after the timeout reply; a late OCR
    // read still raises the capture notice, which is the honest record of it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new RpcError(ErrorCode.timeout, `${tool} took too long`)),
        RUN_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([handler(input), timeout]);
    } catch (error) {
      if (error instanceof RpcError) throw error;
      // Anything else (sight paused, a helper failing) keeps its words instead of "tool failed".
      throw failed(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  return { tools, run };
}
