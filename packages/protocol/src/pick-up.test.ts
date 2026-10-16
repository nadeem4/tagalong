/** Tests for pick-up items and the pickUp messages. */
import { describe, expect, it } from 'vitest';
import {
  coreToHostNotifications,
  notificationParamsSchemaFor,
  paramsSchemaFor,
  resultSchemaFor,
} from './methods';
import { PickUpItem, PickUpReadyParams } from './pick-up';

const PROJECT = {
  id: 'p1',
  kind: 'project',
  name: 'ai_pet',
  path: 'C:\\projects\\ai_pet',
  editor: 'vscode',
  branch: 'feat/scout-watch-tools',
  file: 'engine.ts',
} as const;

const HANDOFF = {
  id: 'h1',
  kind: 'handoff',
  expertName: 'Claude Code',
  ask: 'fix the e2e tests',
  state: 'stopped',
} as const;

describe('PickUpItem', () => {
  it('takes a project, with its branch and file optional', () => {
    expect(PickUpItem.parse(PROJECT)).toEqual(PROJECT);
    const { branch: _b, file: _f, ...bare } = PROJECT;
    expect(PickUpItem.parse(bare)).toEqual(bare);
  });

  it('takes a hand-off that was left unsent, stopped or failed', () => {
    for (const state of ['unsent', 'stopped', 'error'] as const) {
      expect(PickUpItem.parse({ ...HANDOFF, state })).toMatchObject({ state });
    }
    expect(PickUpItem.safeParse({ ...HANDOFF, state: 'done' }).success).toBe(false);
  });

  it('refuses an editor it cannot reopen and a hand-off with no ask', () => {
    expect(PickUpItem.safeParse({ ...PROJECT, editor: 'vim' }).success).toBe(false);
    expect(PickUpItem.safeParse({ ...HANDOFF, ask: '' }).success).toBe(false);
  });
});

describe('pickUp.ready and its methods', () => {
  it('is a notification with one line and at least one item', () => {
    expect(coreToHostNotifications['pickUp.ready']).toBeDefined();
    const ready = { text: 'Yesterday you were in ai_pet.', items: [PROJECT, HANDOFF] };
    expect(notificationParamsSchemaFor('pickUp.ready').parse(ready)).toEqual(ready);
    expect(PickUpReadyParams.safeParse({ ...ready, items: [] }).success).toBe(false);
  });

  it('rebriefs one item by id and dismisses the lot', () => {
    expect(paramsSchemaFor('pickUp.rebrief').parse({ itemId: 'h1' })).toEqual({ itemId: 'h1' });
    expect(resultSchemaFor('pickUp.rebrief').parse({ proposed: true })).toEqual({
      proposed: true,
    });
    expect(paramsSchemaFor('pickUp.dismiss').parse({})).toEqual({});
    expect(resultSchemaFor('pickUp.dismiss').parse({ dismissed: false })).toEqual({
      dismissed: false,
    });
  });

  it('lets greeting.compose carry the pick-up it is saying', () => {
    const line = {
      text: 'Yesterday you were in ai_pet.',
      source: 'fallback',
      pickUp: { text: 'Yesterday you were in ai_pet.', items: [PROJECT] },
    };
    expect(resultSchemaFor('greeting.compose').parse(line)).toEqual(line);
  });
});
