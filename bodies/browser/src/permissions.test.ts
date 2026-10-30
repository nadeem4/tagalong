/** Tests for the permission broker, driven by a fake Chrome permissions API and a fake window. */
import { ErrorCode, RpcError } from '@tagalong/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  denial,
  PERMISSION_WAIT_MS,
  PermissionBroker,
  type Answer,
  type Need,
  type PermissionPrompt,
  type PermissionsApi,
} from './permissions';

const tabsNeed: Need = { kind: 'permission', name: 'tabs' };
const site = (origin: string): Need => ({ kind: 'site', origin });

function setup(opts: { held?: boolean; answer?: Answer | 'never'; heldAfter?: boolean } = {}) {
  let held = opts.held ?? false;
  const api: PermissionsApi = {
    contains: vi.fn(async () => held),
    getAll: async () => ({ permissions: [], origins: [] }),
    remove: async () => true,
  };
  const ask = vi.fn(
    (_need: Need, _reason: string) =>
      new Promise<Answer>((resolve) => {
        if (opts.answer === 'never') return;
        held = opts.heldAfter ?? opts.answer === 'granted';
        resolve(opts.answer ?? 'granted');
      }),
  );
  const prompt: PermissionPrompt = { ask };
  return { broker: new PermissionBroker(api, prompt), ask, api };
}

const rejection = (p: Promise<unknown>): Promise<RpcError> =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as RpcError,
  );

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('PermissionBroker', () => {
  it('allowed_already_resolves_without_a_window', async () => {
    const { broker, ask } = setup({ held: true });
    await broker.ensure(tabsNeed, 'see tabs');
    expect(ask).not.toHaveBeenCalled();
  });

  it('grant_then_resolves_after_a_recheck', async () => {
    const { broker, ask, api } = setup({ answer: 'granted' });
    await broker.ensure(tabsNeed, 'see tabs');
    expect(ask).toHaveBeenCalledWith(tabsNeed, 'see tabs');
    expect(api.contains).toHaveBeenCalledTimes(2);
  });

  it('granted_but_not_actually_held_fails', async () => {
    const { broker } = setup({ answer: 'granted', heldAfter: false });
    const err = await rejection(broker.ensure(tabsNeed, 'see tabs'));
    expect(err).toBeInstanceOf(RpcError);
    expect(err.code).toBe(ErrorCode.tool_failed);
  });

  it('declined_fails_with_the_plain_sentence', async () => {
    const { broker } = setup({ answer: 'declined' });
    const err = await rejection(broker.ensure(tabsNeed, 'see tabs'));
    expect(err.code).toBe(ErrorCode.tool_failed);
    expect(err.message).toBe(denial(tabsNeed));
  });

  it('closed_fails_with_the_plain_sentence', async () => {
    const { broker } = setup({ answer: 'closed' });
    const err = await rejection(broker.ensure(site('https://example.com'), 'read it'));
    expect(err.code).toBe(ErrorCode.tool_failed);
    expect(err.message).toBe(denial(site('https://example.com')));
  });

  it('silence_fails_after_25s', async () => {
    const { broker } = setup({ answer: 'never' });
    let settled = false;
    const result = rejection(broker.ensure(tabsNeed, 'see tabs')).then((e) => {
      settled = true;
      return e;
    });
    await vi.advanceTimersByTimeAsync(PERMISSION_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await result;
    expect(PERMISSION_WAIT_MS).toBe(25_000);
    expect(err.code).toBe(ErrorCode.tool_failed);
    expect(err.message).toBe(denial(tabsNeed));
  });

  it('two_calls_for_the_same_need_share_one_window', async () => {
    const { broker, ask } = setup({ answer: 'granted' });
    await Promise.all([broker.ensure(tabsNeed, 'one'), broker.ensure(tabsNeed, 'two')]);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('different_needs_open_separate_windows', async () => {
    const { broker, ask } = setup({ answer: 'granted' });
    await Promise.all([
      broker.ensure(site('https://a.test'), 'a'),
      broker.ensure(site('https://b.test'), 'b'),
    ]);
    expect(ask).toHaveBeenCalledTimes(2);
  });
});

describe('denial', () => {
  it('denial_sentences_name_the_site_or_the_ability', () => {
    expect(denial(site('https://example.com'))).toBe(
      'the person has not allowed reading example.com',
    );
    expect(denial(tabsNeed)).toBe('the person has not allowed Scout to see open tabs');
  });

  it('denial_names_local_files_for_a_file_origin', () => {
    expect(denial(site('file://'))).toBe('the person has not allowed reading local files');
  });
});
