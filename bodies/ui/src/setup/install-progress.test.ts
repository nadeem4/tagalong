/**
 * Checks for how the brain's real install progress reads on the card: each stage has its own
 * words, a percent shows only when the brain sent one, and the old single "Installing" stage is
 * gone.
 */
import { describe, expect, it } from 'vitest';
import { expertWorking, stageWords } from './install-progress';

const STAGES = [
  'checking',
  'node',
  'resolving',
  'fetching',
  'finishing',
  'downloading',
  'extracting',
  'done',
];

describe('expert install progress', () => {
  it('progress_renders_stage_and_percent', () => {
    expect(expertWorking({ stage: 'downloading', percent: 40 })).toEqual({
      phase: 'working',
      label: 'Downloading…',
      percent: 40,
    });
    expect(expertWorking({ stage: 'fetching' })).toEqual({
      phase: 'working',
      label: 'Downloading its files…',
    });
  });

  it('gives every stage the brain sends its own words', () => {
    const words = STAGES.map((stage) => stageWords({ stage }));
    expect(new Set(words).size).toBe(words.length);
    expect(words).not.toContain('Working');
    expect(stageWords({ stage: 'installing' })).toBe('Working');
  });
});
