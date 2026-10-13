import { describe, expect, it } from 'vitest';
import { pickSystemVoice } from './voice-player';

const voice = (name: string, lang: string) => ({ name, lang });

describe('pickSystemVoice', () => {
  it('prefers George, the British male Windows voice, when it is installed', () => {
    const voices = [
      voice('Microsoft Zira - English (United States)', 'en-US'),
      voice('Microsoft Hazel - English (United Kingdom)', 'en-GB'),
      voice('Microsoft George - English (United Kingdom)', 'en-GB'),
    ];
    expect(pickSystemVoice(voices)?.name).toBe('Microsoft George - English (United Kingdom)');
  });

  it('takes another British male voice when George is not there', () => {
    const voices = [
      voice('Microsoft Hazel - English (United Kingdom)', 'en-GB'),
      voice('Microsoft Ryan Online (Natural) - English (United Kingdom)', 'en-GB'),
    ];
    expect(pickSystemVoice(voices)?.name).toMatch(/Ryan/);
  });

  it('leaves the default voice when no British male voice is installed', () => {
    expect(pickSystemVoice([voice('Microsoft Zira - English (United States)', 'en-US')])).toBe(
      undefined,
    );
    expect(pickSystemVoice([])).toBe(undefined);
  });
});
