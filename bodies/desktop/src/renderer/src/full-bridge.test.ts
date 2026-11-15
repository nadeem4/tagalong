/**
 * Tests for the voice-sample player the bridge hands to the picker: one sample at a time,
 * starting a new one stops the one before it. Fake player, no audio.
 */
import { describe, expect, it } from 'vitest';
import { makeSamplePlayer } from './full-bridge';

describe('makeSamplePlayer', () => {
  it('aborts the previous sample before starting the next', async () => {
    const signals: AbortSignal[] = [];
    const play = makeSamplePlayer((_voice, _speed, signal) => {
      signals.push(signal);
      return new Promise<void>(() => {});
    });
    void play('piper-alan', 1);
    expect(signals[0]!.aborted).toBe(false);
    void play('kokoro-bm-george', 1);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });
});
