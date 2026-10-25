/** Tests for the system-voice pick, prepareLine and onSystemVoice. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onSystemVoice, pickSystemVoice, prepareLine } from './voice-player';

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

describe('prepareLine', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks main for the audio at once, before the line is played', () => {
    const speak = vi.fn(() => new Promise<never>(() => undefined));
    vi.stubGlobal('window', { tagalongHost: { speak } });
    prepareLine('Hello there.');
    expect(speak).toHaveBeenCalledWith('Hello there.', undefined);
  });

  it('plays nothing when stopped before it was played', async () => {
    vi.stubGlobal('window', {
      tagalongHost: { speak: () => Promise.resolve({ kind: 'fallback' }) },
    });
    const speakSystem = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak: speakSystem, getVoices: () => [] });
    const play = prepareLine('Hello there.');
    const controller = new AbortController();
    controller.abort();
    await play(controller.signal);
    expect(speakSystem).not.toHaveBeenCalled();
  });

  it('leaves no failed synthesis unhandled when the line is dropped', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    vi.stubGlobal('window', {
      tagalongHost: { speak: () => Promise.reject(new Error('no voice')) },
    });
    prepareLine('Hello there.');
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('onSystemVoice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says when the system voice starts and stops speaking, and a listener let go hears nothing', async () => {
    vi.stubGlobal('window', {
      tagalongHost: { speak: () => Promise.resolve({ kind: 'fallback' }) },
    });
    vi.stubGlobal('document', { documentElement: { style: { setProperty: vi.fn() } } });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        onend: (() => void) | null = null;
        constructor(readonly text: string) {}
      },
    );
    let spoken!: { onend: () => void };
    vi.stubGlobal('speechSynthesis', {
      speak: (utterance: { onend: () => void }) => (spoken = utterance),
      getVoices: () => [],
    });
    const heard: boolean[] = [];
    const gone: boolean[] = [];
    const off = onSystemVoice((speaking) => heard.push(speaking));
    onSystemVoice((speaking) => gone.push(speaking))();
    expect(heard).toEqual([]);
    const playing = prepareLine('Hello there.')(new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).toEqual([true]);
    spoken.onend();
    await playing;
    expect(heard).toEqual([true, false]);
    expect(gone).toEqual([]);
    off();
  });
});
