/**
 * Tests for the pure voice session: what it asks of the brain and the mic, and when it sends the
 * spoken question. Fakes only; no Chrome and no timers beyond the fake clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrainOffline } from '@tagalong/contract';
import { createVoiceSession, type VoiceView } from './voice-session';

function setup(opts: { listen?: () => Promise<void>; micStart?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const views: VoiceView[] = [];
  const said: string[] = [];
  const session = createVoiceSession({
    client: {
      listen: (mode) => {
        calls.push(`listen:${mode}`);
        return opts.listen ? opts.listen() : Promise.resolve();
      },
      mic: () => {
        calls.push('frame');
        return true;
      },
      unlisten: () => void calls.push('unlisten'),
    },
    mic: {
      start: () => {
        calls.push('mic:start');
        return opts.micStart ? opts.micStart() : Promise.resolve();
      },
      stop: () => {
        calls.push('mic:stop');
        return Promise.resolve();
      },
    },
    say: (text) => {
      said.push(text);
      return Promise.resolve();
    },
    onChange: (view) => views.push(view),
  });
  return { session, calls, views, said };
}

describe('voice session', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('start_listens_held_then_opens_the_mic', async () => {
    const { session, calls } = setup();
    await session.start();
    expect(calls).toEqual(['listen:held', 'mic:start']);
    expect(session.view().state).toBe('listening');
  });

  it('a_second_start_while_active_is_ignored', async () => {
    const { session, calls } = setup();
    await session.start();
    await session.start();
    expect(calls.filter((c) => c === 'listen:held')).toHaveLength(1);
  });

  it('frames_go_to_the_brain_only_while_listening', async () => {
    const { session, calls } = setup();
    session.frame(new Int16Array(512));
    await session.start();
    session.frame(new Int16Array(512));
    session.stop();
    session.frame(new Int16Array(512));
    expect(calls.filter((c) => c === 'frame')).toHaveLength(1);
  });

  it('stop_closes_the_mic_and_the_listen_then_waits_for_the_turn_end', async () => {
    const { session, calls } = setup();
    await session.start();
    session.stop();
    expect(calls.slice(-2)).toEqual(['mic:stop', 'unlisten']);
    expect(session.view().state).toBe('thinking');
  });

  it('turn_end_sends_exactly_one_spoken_question', async () => {
    const { session, said } = setup();
    await session.start();
    session.onHeard('partial', 'what is');
    expect(session.view().text).toBe('what is');
    session.stop();
    session.onHeard('turn_end', 'what is this page');
    session.onHeard('turn_end', 'what is this page');
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toEqual(['what is this page']);
    expect(session.view().state).toBe('idle');
  });

  it('no_words_says_nothing_and_goes_idle', async () => {
    const { session, said } = setup();
    await session.start();
    session.stop();
    session.onHeard('turn_end', '  ');
    expect(said).toEqual([]);
    expect(session.view().state).toBe('idle');
  });

  it('a_turn_end_that_never_comes_goes_idle', async () => {
    const { session } = setup();
    await session.start();
    session.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.view().state).toBe('idle');
  });

  it('a_late_turn_end_while_the_ears_download_still_sends_the_question', async () => {
    const { session, said } = setup();
    await session.start();
    session.onVoice('loading', undefined, 0.3);
    expect(session.view()).toMatchObject({ loading: true, progress: 0.3 });
    session.stop();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(session.view().state).toBe('thinking');
    session.onHeard('turn_end', 'what is this page');
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toEqual(['what is this page']);
  });

  it('the_wait_starts_when_the_ears_are_ready', async () => {
    const { session } = setup();
    await session.start();
    session.onVoice('loading', undefined, 0.5);
    session.stop();
    session.onVoice('ready');
    expect(session.view().loading).toBe(false);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(session.view().state).toBe('thinking');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.view().state).toBe('idle');
  });

  it('a_brain_that_is_offline_is_an_error_not_a_throw', async () => {
    const { session, calls } = setup({ listen: () => Promise.reject(new BrainOffline()) });
    await session.start();
    expect(session.view().state).toBe('error');
    expect(session.view().error).toContain('not reachable');
    expect(calls).not.toContain('mic:start');
  });

  it('a_brain_with_no_voice_is_an_error_with_its_own_line', async () => {
    const { session } = setup({ listen: () => Promise.reject(new Error('method_not_found')) });
    await session.start();
    expect(session.view().error).toContain('cannot hear');
  });

  it('a_mic_that_will_not_start_ends_the_listen', async () => {
    const { session, calls } = setup({ micStart: () => Promise.reject(new Error('denied')) });
    await session.start();
    expect(session.view().state).toBe('error');
    expect(calls).toContain('unlisten');
  });

  it('voice_failed_surfaces_the_brains_line', async () => {
    const { session } = setup();
    await session.start();
    session.onVoice('failed', 'The speech model did not download.');
    expect(session.view()).toMatchObject({
      state: 'error',
      error: 'The speech model did not download.',
    });
  });

  it('end_stops_an_active_session_with_a_reason_and_ignores_an_idle_one', async () => {
    const { session, calls } = setup();
    session.end('gone');
    expect(session.view().state).toBe('idle');
    await session.start();
    session.end('Scout lost the link.');
    expect(session.view()).toMatchObject({ state: 'error', error: 'Scout lost the link.' });
    expect(calls).toContain('mic:stop');
  });

  it('a_failed_say_is_an_error', async () => {
    const bad = createVoiceSession({
      client: { listen: () => Promise.resolve(), mic: () => true, unlisten: () => undefined },
      mic: { start: () => Promise.resolve(), stop: () => Promise.resolve() },
      say: () => Promise.reject(new Error('boom')),
      onChange: () => undefined,
    });
    await bad.start();
    bad.stop();
    bad.onHeard('turn_end', 'hello');
    await vi.advanceTimersByTimeAsync(0);
    expect(bad.view().state).toBe('error');
  });
});
