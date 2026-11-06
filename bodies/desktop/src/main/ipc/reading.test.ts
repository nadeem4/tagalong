/** Tests for the reading IPC: a re-check detects and pushes once; Settings opens one fixed page. */

import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerReadingIpc } from './reading';

const STATUS = { rows: [] };

function setup() {
  const ipc = fakeIpc();
  const opened: string[] = [];
  const detect = vi.fn(async () => STATUS);
  const push = vi.fn();
  registerReadingIpc(ipc.handle, {
    detect,
    push,
    openExternal: async (url) => void opened.push(url),
  });
  return { ...ipc, opened, detect, push };
}

describe('registerReadingIpc', () => {
  it('reading:recheck detects once and pushes what it found', async () => {
    const { invoke, detect, push } = setup();
    await invoke(IPC.readingRecheck);
    expect(detect).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith(STATUS);
  });

  it('reading:open-language-settings opens the Windows page and nothing the renderer names', async () => {
    const { invoke, opened } = setup();
    await invoke(IPC.readingOpenLanguageSettings, 'https://evil.example/');
    await invoke(IPC.readingOpenLanguageSettings);
    expect(opened).toEqual(['ms-settings:regionlanguage', 'ms-settings:regionlanguage']);
  });
});
