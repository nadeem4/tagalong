/** Tests for the pick-up card's IPC. */

import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { PickUpAllowlist } from '../pick-up-open';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerPickUpIpc } from './pick-up';

function setup(problem = '') {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'pickUp.rebrief': { proposed: true },
    'pickUp.dismiss': { dismissed: true },
  });
  const allowlist = new PickUpAllowlist();
  allowlist.set({
    text: 'Yesterday you were in ai_pet.',
    items: [
      { id: 'p1', kind: 'project', name: 'ai_pet', path: 'C:\\ai_pet', editor: 'vscode' },
      { id: 'p2', kind: 'project', name: 'api', path: 'C:\\api', editor: 'other' },
    ],
  });
  const openExternal = vi.fn(() => Promise.resolve());
  const openPath = vi.fn(() => Promise.resolve(problem));
  registerPickUpIpc(ipc.handle, { engine: () => engine.client, allowlist, openExternal, openPath });
  return { ...ipc, calls: engine.calls, allowlist, openExternal, openPath };
}

describe('pick-up IPC', () => {
  it('opens VS Code by its link and another editor’s folder, from the current pick-up only', async () => {
    const { invoke, openExternal, openPath } = setup();
    await invoke(IPC.openPickUp, 'p1');
    expect(openExternal).toHaveBeenCalledWith('vscode://file/C:/ai_pet');
    await invoke(IPC.openPickUp, 'p2');
    expect(openPath).toHaveBeenCalledWith('C:\\api');
  });

  it('refuses anything the current pick-up did not name, and drives no keys or mouse', async () => {
    const { invoke, openExternal, openPath } = setup();
    await expect(invoke(IPC.openPickUp, 'C:\\Windows\\System32')).rejects.toThrow(/only opens/);
    expect(openExternal).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  it('says why a folder did not open', async () => {
    const { invoke } = setup('The folder is gone.');
    await expect(invoke(IPC.openPickUp, 'p2')).rejects.toThrow('The folder is gone.');
  });

  it('briefs again through the engine, and Not now drops the offer and the allowlist', async () => {
    const { invoke, calls, allowlist } = setup();
    await invoke(IPC.rebriefPickUp, 'h1');
    await invoke(IPC.dismissPickUp);
    expect(calls).toEqual([
      ['pickUp.rebrief', { itemId: 'h1' }],
      ['pickUp.dismiss', {}],
    ]);
    expect(allowlist.open('p1')).toBeNull();
  });
});
