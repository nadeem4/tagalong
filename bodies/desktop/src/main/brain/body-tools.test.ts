/** Tests for the desktop's body tools: declarations, minimized windows, refusals, notices, timeout. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, Tool } from '@tagalong/contract';
import type { CaptureExclusions } from '@tagalong/protocol';
import type { Platform } from '../platform/index';
import { bodyTools } from './body-tools';
import { RpcError } from './brain-client';

const exclusions = { processNames: [], titlePatterns: [] } as unknown as CaptureExclusions;

const windows = [
  { id: 'w1', processName: 'code', title: 'a.ts', state: 'foreground', browser: false },
  { id: 'w2', processName: 'notes', title: 'todo', state: 'minimized', browser: false },
];

function setup(overrides: Record<string, unknown> = {}) {
  const platform = {
    listWindows: vi.fn(async () => ({ windows })),
    readWindowText: vi.fn(async (p: { windowId?: string }) => ({
      windowId: p.windowId ?? 'w1',
      text: 'hello',
      truncated: false,
      source: 'uia' as const,
    })),
    lookAtWindow: vi.fn(async (p: { windowId: string }) => ({
      windowId: p.windowId,
      image: { mime: 'image/png' as const, base64: 'AAAA', width: 2, height: 2 },
    })),
    ...overrides,
  };
  const onCapture = vi.fn();
  const tools = bodyTools(platform as unknown as Platform, () => exclusions, onCapture);
  return { platform, onCapture, ...tools };
}

describe('bodyTools declarations', () => {
  it('declares exactly list_windows, read_window_text and look_at_window, all valid', () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual([
      'list_windows',
      'read_window_text',
      'look_at_window',
    ]);
    for (const tool of tools) expect(Tool.safeParse(tool).success).toBe(true);
  });
});

describe('list_windows', () => {
  it('returns visible and minimized windows as JSON text', async () => {
    const { run } = setup();
    const [part] = await run('list_windows', {});
    expect(part?.type).toBe('text');
    const listed = JSON.parse((part as { text: string }).text);
    expect(listed.windows.map((w: { id: string }) => w.id)).toEqual(['w1', 'w2']);
    expect(listed.windows[1].state).toBe('minimized');
  });
});

describe('read_window_text', () => {
  it('reads a minimized window', async () => {
    const { run, platform } = setup();
    const [part] = await run('read_window_text', { windowId: 'w2' });
    expect(platform.readWindowText).toHaveBeenCalledWith(
      expect.objectContaining({ windowId: 'w2' }),
      exclusions,
    );
    expect((part as { text: string }).text).toContain('hello');
  });

  it('raises the capture notice when the text came from pixels', async () => {
    const { run, onCapture } = setup({
      readWindowText: async () => ({
        windowId: 'w1',
        text: 'seen',
        truncated: false,
        source: 'ocr',
      }),
    });
    await run('read_window_text', { windowId: 'w1' });
    expect(onCapture).toHaveBeenCalledOnce();
    expect(onCapture.mock.calls[0]?.[0]).toMatchObject({ screenshot: true });
  });

  it('raises no notice for a text-layer read', async () => {
    const { run, onCapture } = setup();
    await run('read_window_text', { windowId: 'w1' });
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('refuses an excluded window with the exclusion sentence as tool_failed', async () => {
    const sentence = "This window is on the user's capture exclusion list.";
    const { run } = setup({
      readWindowText: async () => ({
        windowId: 'w1',
        text: '',
        truncated: false,
        source: 'uia',
        blocked: { rule: 'processName', entry: 'vault' },
        notes: [sentence],
      }),
    });
    const error = await run('read_window_text', { windowId: 'w1' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: ErrorCode.tool_failed, message: sentence });
  });
});

describe('look_at_window', () => {
  it('returns an image part', async () => {
    const { run, onCapture } = setup();
    const parts = await run('look_at_window', { windowId: 'w1' });
    expect(parts[0]).toEqual({ type: 'image', mime: 'image/png', data: 'AAAA' });
    expect(onCapture).toHaveBeenCalledOnce();
  });

  it('refuses a minimized window', async () => {
    const { run, platform } = setup();
    await expect(run('look_at_window', { windowId: 'w2' })).rejects.toMatchObject({
      code: ErrorCode.tool_failed,
      message: 'That window is minimized, so there is nothing drawn to look at.',
    });
    expect(platform.lookAtWindow).not.toHaveBeenCalled();
  });

  it('refuses an excluded window with the exclusion sentence', async () => {
    const sentence = 'This window is a blind spot.';
    const { run } = setup({
      lookAtWindow: async () => ({
        windowId: 'w1',
        blocked: { rule: 'processName', entry: 'vault' },
        notes: [sentence],
      }),
    });
    await expect(run('look_at_window', { windowId: 'w1' })).rejects.toMatchObject({
      code: ErrorCode.tool_failed,
      message: sentence,
    });
  });
});

describe('run limits', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers timeout after 15 s', async () => {
    const { run } = setup({ listWindows: () => new Promise(() => undefined) });
    const result = run('list_windows', {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toMatchObject({ code: ErrorCode.timeout });
  });

  it('rejects an unknown tool', async () => {
    const { run } = setup();
    await expect(run('nope', {})).rejects.toMatchObject({ code: ErrorCode.unknown_tool });
  });
});
