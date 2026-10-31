/** Tests for the walkthrough's launch gate: when it opens, and when the pets show. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../shared/ipc';
import { fakeIpc } from './ipc/fake-ipc';
import { registerWalkthroughIpc } from './ipc/walkthrough';
import { createWalkthroughGate, petsVisible, shouldOpenWalkthrough } from './walkthrough-gate';

describe('shouldOpenWalkthrough', () => {
  it('opens at launch until the tour is finished or skipped', () => {
    expect(shouldOpenWalkthrough({ walkthrough: { done: false } })).toBe(true);
    expect(shouldOpenWalkthrough({ walkthrough: { done: true } })).toBe(false);
  });
});

describe('petsVisible', () => {
  it('hides the pet, bubble and dock only while the walkthrough is open', () => {
    expect(petsVisible({ walkthroughOpen: true })).toBe(false);
    expect(petsVisible({ walkthroughOpen: false })).toBe(true);
  });
});

function setup(options: { petVisible?: boolean } = {}) {
  const state = {
    petVisible: options.petVisible ?? true,
    bubbleHidden: 0,
    created: [] as (number | undefined)[],
    focused: 0,
    reloaded: [] as number[],
    closeWindow: (() => undefined) as () => void,
  };
  const gate = createWalkthroughGate({
    pet: {
      isVisible: () => state.petVisible,
      show: () => void (state.petVisible = true),
      hide: () => void (state.petVisible = false),
    },
    bubble: { hide: () => void (state.bubbleHidden += 1) },
    create: (step, onClosed) => {
      state.created.push(step);
      state.closeWindow = onClosed;
      return {
        focus: () => void (state.focused += 1),
        reloadAt: (at) => void state.reloaded.push(at),
        close: () => onClosed(),
      };
    },
  });
  const ipc = fakeIpc();
  const saved: unknown[] = [];
  registerWalkthroughIpc(ipc.handle, {
    save: (patch) => void saved.push(patch),
    open: (step) => gate.open(step),
    close: () => gate.close(),
  });
  return { gate, state, saved, ...ipc };
}

describe('walkthrough gate', () => {
  it('opens at launch with no brain at all, and the pet it never showed counts as visible', () => {
    const { gate, state } = setup({ petVisible: false });
    gate.openAtLaunch();
    expect(state.created).toEqual([undefined]);
    expect(gate.isOpen()).toBe(true);
    expect(state.petVisible).toBe(false);
    state.closeWindow();
    expect(state.petVisible).toBe(true);
  });

  it('hides the pet and bubble while it is open', () => {
    const { gate, state } = setup();
    gate.open();
    expect(state.petVisible).toBe(false);
    expect(state.bubbleHidden).toBe(1);
    expect(gate.isOpen()).toBe(true);
  });

  it('Finish sets done and shows the pet again', async () => {
    const { gate, state, saved, invoke } = setup();
    gate.open();
    await invoke(IPC.walkthroughFinish);
    expect(saved).toEqual([{ walkthrough: { done: true } }]);
    expect(gate.isOpen()).toBe(false);
    expect(state.petVisible).toBe(true);
  });

  it('closing part-way shows the pet and leaves done alone', () => {
    const { gate, state, saved } = setup();
    gate.open();
    state.closeWindow();
    expect(saved).toEqual([]);
    expect(state.petVisible).toBe(true);
  });

  it('Show the tour again hides them again, and clears done', async () => {
    const { gate, state, saved, invoke } = setup();
    gate.open();
    state.closeWindow();
    await invoke(IPC.walkthroughOpen, { step: 1 });
    expect(saved).toEqual([{ walkthrough: { done: false } }]);
    expect(state.petVisible).toBe(false);
    expect(gate.isOpen()).toBe(true);
  });

  it('puts the pet back only if it was showing when the tour opened', () => {
    const { gate, state } = setup({ petVisible: false });
    gate.open();
    state.closeWindow();
    expect(state.petVisible).toBe(false);
  });

  it('opening again brings the open window forward, at the step when one is named', () => {
    const { gate, state } = setup();
    gate.open();
    gate.open(9);
    gate.bringForward();
    expect(state.created).toHaveLength(1);
    expect(state.reloaded).toEqual([9]);
    expect(state.focused).toBe(2);
  });
});
