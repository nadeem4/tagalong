import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { MAX_COPY_CHARS, registerClipboardIpc } from './clipboard';

const PANEL = { sender: 'panel' };
const OTHER = { sender: 'home' };

function setup() {
  const ipc = fakeIpc();
  const clipboard = { writeText: vi.fn(), readText: vi.fn() };
  registerClipboardIpc(ipc.handle, {
    writeText: clipboard.writeText,
    fromPanel: (event) => (event as typeof PANEL).sender === 'panel',
  });
  const invokeFrom = (event: unknown, ...args: unknown[]) =>
    ipc.invokeWith(event, IPC.copyText, ...args);
  return { clipboard, invokeFrom };
}

describe('registerClipboardIpc', () => {
  it("puts the panel's draft on the clipboard", async () => {
    const { clipboard, invokeFrom } = setup();
    await invokeFrom(PANEL, 'Yes, Friday works.');
    expect(clipboard.writeText).toHaveBeenCalledWith('Yes, Friday works.');
  });

  it('takes a draft right at the limit', async () => {
    const { clipboard, invokeFrom } = setup();
    await invokeFrom(PANEL, 'a'.repeat(MAX_COPY_CHARS));
    expect(clipboard.writeText).toHaveBeenCalledOnce();
  });

  it('refuses anything but a string', async () => {
    const { clipboard, invokeFrom } = setup();
    await expect(invokeFrom(PANEL, { text: 'hi' })).rejects.toThrow('only text');
    await expect(invokeFrom(PANEL)).rejects.toThrow('only text');
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('refuses text over 20,000 characters', async () => {
    const { clipboard, invokeFrom } = setup();
    expect(MAX_COPY_CHARS).toBe(20_000);
    await expect(invokeFrom(PANEL, 'a'.repeat(MAX_COPY_CHARS + 1))).rejects.toThrow('too long');
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('refuses any window but the panel', async () => {
    const { clipboard, invokeFrom } = setup();
    await expect(invokeFrom(OTHER, 'hi')).rejects.toThrow('only from the bubble');
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('never reads the clipboard', async () => {
    const { clipboard, invokeFrom } = setup();
    await invokeFrom(PANEL, 'hi');
    await invokeFrom(OTHER, 'hi').catch(() => undefined);
    expect(clipboard.readText).not.toHaveBeenCalled();
  });
});
