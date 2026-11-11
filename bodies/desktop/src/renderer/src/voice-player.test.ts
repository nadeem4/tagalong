/** Tests for the system-voice pick, and the speech player. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySpeechControl,
  pickSystemVoice,
  previewVoice,
  SpeechPlayer,
  speakWithSystem,
} from './voice-player';

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

/** Engines that finish a line only when the test says so. */
function fakeEngines() {
  const played: string[] = [];
  const pending: (() => void)[] = [];
  const hold = (label: string, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      played.push(label);
      pending.push(resolve);
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  return {
    played,
    finish: () => pending.shift()?.(),
    engines: {
      pcm: (_pcm: string, rate: number, signal: AbortSignal) => hold(`pcm@${rate}`, signal),
      system: (text: string, signal: AbortSignal) => hold(`system:${text}`, signal),
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function player(mouth: 'kokoro' | 'system' = 'kokoro') {
  const fake = fakeEngines();
  const states: { speaking: boolean; answering: boolean }[] = [];
  const hush = vi.fn();
  const outputs: string[] = [];
  const speech: { turn: string; n?: number; state: string }[] = [];
  const p = new SpeechPlayer({
    engines: fake.engines,
    mouth: () => mouth,
    output: { pause: () => void outputs.push('pause'), resume: () => void outputs.push('resume') },
    hush,
    onState: (state) => states.push(state),
    onSpeech: (event) => speech.push(event),
  });
  return { ...fake, p, states, hush, outputs, speech };
}

describe('SpeechPlayer', () => {
  it('plays a turn’s sentences one after another, and is answering until the turn’s speech is done', async () => {
    const { p, played, finish, states } = player();
    p.enqueue({ turn: 't1', text: 'One.', pcm: 'AA==', sampleRate: 24000 });
    p.enqueue({ turn: 't1', text: 'Two.', pcm: 'AA==', sampleRate: 24000 });
    await tick();
    expect(played).toEqual(['pcm@24000']);
    finish();
    await tick();
    expect(played).toEqual(['pcm@24000', 'pcm@24000']);
    finish();
    await tick();
    expect(states.at(-1)).toEqual({ speaking: false, answering: true });
    p.done('t1');
    expect(states.at(-1)).toEqual({ speaking: false, answering: false });
    expect(states.some((s) => s.speaking && s.answering)).toBe(true);
  });

  it('says text-only sentences in the system voice', async () => {
    const { p, played } = player();
    p.enqueue({ turn: 't1', text: 'Plain.' });
    await tick();
    expect(played).toEqual(['system:Plain.']);
  });

  it('with the System voice picked, ignores the audio and says the text', async () => {
    const { p, played } = player('system');
    p.enqueue({ turn: 't1', text: 'Hi.', pcm: 'AA==', sampleRate: 24000 });
    await tick();
    expect(played).toEqual(['system:Hi.']);
  });

  it('cutOff silences the line, drops the rest, tells the brain, and ignores that turn’s late sentences', async () => {
    const { p, played, states, hush } = player();
    p.enqueue({ turn: 't1', text: 'One.', pcm: 'AA==', sampleRate: 24000 });
    p.enqueue({ turn: 't1', text: 'Two.', pcm: 'AA==', sampleRate: 24000 });
    await tick();
    p.cutOff();
    await tick();
    expect(hush).toHaveBeenCalledOnce();
    expect(played).toEqual(['pcm@24000']);
    expect(states.at(-1)).toEqual({ speaking: false, answering: false });
    p.enqueue({ turn: 't1', text: 'Late.', pcm: 'AA==', sampleRate: 24000 });
    await tick();
    expect(played).toEqual(['pcm@24000']);
    p.enqueue({ turn: 't2', text: 'Next.', pcm: 'AA==', sampleRate: 24000 });
    await tick();
    expect(played).toEqual(['pcm@24000', 'pcm@24000']);
  });

  describe('pause and what was heard', () => {
    const sentence = (turn: string, n: number, text: string) => ({
      turn,
      n,
      text,
      pcm: 'AA==',
      sampleRate: 24000,
    });

    it('pause holds the sound and speaking turns false; resume carries on', async () => {
      const { p, outputs, states } = player();
      p.enqueue(sentence('t1', 1, 'One.'));
      await tick();
      expect(p.speaking).toBe(true);
      p.pause();
      expect(outputs).toEqual(['pause']);
      expect(p.speaking).toBe(false);
      p.resume();
      expect(outputs).toEqual(['pause', 'resume']);
      expect(p.speaking).toBe(true);
      // The panel's state stays "speaking" through a pause: the answer has not ended.
      expect(states.at(-1)?.speaking).toBe(true);
    });

    it('counts the sentences played to the end, not the one cut or the ones waiting', async () => {
      const { p, finish } = player();
      p.enqueue(sentence('t1', 1, 'One.'));
      p.enqueue(sentence('t1', 2, 'Two.'));
      p.enqueue(sentence('t1', 3, 'Three.'));
      await tick();
      finish();
      await tick();
      p.pause();
      expect(p.interruption()).toEqual({ turn: 't1', heard: 1 });
      p.cutOff();
      await tick();
      expect(p.interruption()).toBeNull();
    });

    it('gives the sentence playing and the one before, never the queued ones', async () => {
      const { p, finish } = player();
      p.enqueue(sentence('t1', 1, 'One.'));
      p.enqueue(sentence('t1', 2, 'Two.'));
      p.enqueue(sentence('t1', 3, 'Three.'));
      await tick();
      expect(p.text()).toBe('One.');
      finish();
      await tick();
      expect(p.text()).toBe('One. Two.');
      finish();
      await tick();
      expect(p.text()).toBe('Two. Three.');
      p.enqueue(sentence('t2', 1, 'Fresh.'));
      expect(p.text()).toBe('Fresh.');
    });

    it('cutOff clears the pause so the next sentence plays', async () => {
      const { p, outputs, played } = player();
      p.enqueue(sentence('t1', 1, 'One.'));
      await tick();
      p.pause();
      p.cutOff();
      expect(outputs).toEqual(['pause', 'resume']);
      p.enqueue(sentence('t2', 1, 'Next.'));
      await tick();
      expect(played).toHaveLength(2);
      expect(p.speaking).toBe(true);
    });

    it('has nothing to report when nothing was spoken', () => {
      expect(player().p.interruption()).toBeNull();
    });
  });
  describe('pause, resume, clear and the states the brain hears', () => {
    const sentence = (n: number) => ({
      turn: 't1',
      n,
      text: `S${n}.`,
      pcm: 'AA==',
      sampleRate: 24000,
    });

    it('player emits started and ended per sentence, then idle when it runs dry', async () => {
      const { p, finish, speech } = player();
      p.enqueue(sentence(1));
      p.enqueue(sentence(2));
      await tick();
      expect(speech).toEqual([{ turn: 't1', n: 1, state: 'started' }]);
      finish();
      await tick();
      finish();
      await tick();
      expect(speech).toEqual([
        { turn: 't1', n: 1, state: 'started' },
        { turn: 't1', n: 1, state: 'ended' },
        { turn: 't1', n: 2, state: 'started' },
        { turn: 't1', n: 2, state: 'ended' },
        { turn: 't1', state: 'idle' },
      ]);
    });

    it('pause keeps unplayed sentences: none starts, none is lost', async () => {
      const { p, played, finish, speech } = player();
      p.enqueue(sentence(1));
      p.enqueue(sentence(2));
      p.enqueue(sentence(3));
      await tick();
      p.pause();
      expect(speech.at(-1)).toEqual({ turn: 't1', state: 'paused' });
      finish();
      await tick();
      expect(played).toHaveLength(1);
      p.resume();
      await tick();
      expect(played).toHaveLength(2);
      finish();
      await tick();
      expect(played).toHaveLength(3);
    });

    it('resume continues from the paused sentence without replaying it', async () => {
      const { p, played, finish, outputs, speech } = player();
      p.enqueue(sentence(1));
      p.enqueue(sentence(2));
      await tick();
      p.pause();
      p.resume();
      expect(outputs).toEqual(['pause', 'resume']);
      expect(played).toHaveLength(1);
      expect(speech.at(-1)).toEqual({ turn: 't1', n: 1, state: 'started' });
      finish();
      await tick();
      expect(played).toHaveLength(2);
    });

    it('clear drops the rest and says idle, without telling the brain to hush', async () => {
      const { p, played, speech, hush, outputs } = player();
      p.enqueue(sentence(1));
      p.enqueue(sentence(2));
      await tick();
      p.pause();
      p.clear();
      await tick();
      expect(hush).not.toHaveBeenCalled();
      expect(outputs).toEqual(['pause', 'resume']);
      expect(played).toHaveLength(1);
      expect(speech.at(-1)).toEqual({ turn: 't1', state: 'idle' });
      expect(p.interruption()).toBeNull();
    });

    it('a pause between sentences holds the next one that arrives until resume', async () => {
      const { p, played, finish, speech } = player();
      p.enqueue(sentence(1));
      await tick();
      finish();
      await tick();
      p.pause();
      expect(speech.at(-1)).toEqual({ turn: 't1', state: 'paused' });
      p.enqueue(sentence(2));
      await tick();
      expect(played).toHaveLength(1);
      p.resume();
      await tick();
      expect(played).toHaveLength(2);
    });

    it('pause with nothing spoken or waiting does nothing and sends no state', () => {
      const { p, outputs, speech } = player();
      p.pause();
      expect(outputs).toEqual([]);
      expect(speech).toEqual([]);
    });

    it('a new turn’s sentence arriving while paused stays held and sends no state', async () => {
      const { p, played, finish, speech } = player();
      p.enqueue(sentence(1));
      await tick();
      p.pause();
      const told = speech.length;
      p.enqueue({ turn: 't2', n: 1, text: 'New.', pcm: 'AA==', sampleRate: 24000 });
      await tick();
      expect(speech).toHaveLength(told);
      expect(played).toHaveLength(1);
      p.resume();
      finish();
      await tick();
      expect(played).toHaveLength(2);
    });

    it('clear of a queued turn drops only that turn and keeps the one playing', async () => {
      const { p, played, finish, speech } = player();
      p.enqueue(sentence(1));
      p.enqueue({ turn: 't2', n: 1, text: 'Two.', pcm: 'AA==', sampleRate: 24000 });
      await tick();
      p.clear('t2');
      p.enqueue({ turn: 't2', n: 2, text: 'Late.', pcm: 'AA==', sampleRate: 24000 });
      finish();
      await tick();
      expect(played).toHaveLength(1);
      expect(speech.some((e) => e.turn === 't2')).toBe(false);
    });

    it('clear of the playing turn leaves a queued other turn to speak', async () => {
      const { p, played, speech } = player();
      p.enqueue(sentence(1));
      p.enqueue({ turn: 't2', n: 1, text: 'Two.', pcm: 'AA==', sampleRate: 24000 });
      await tick();
      p.clear('t1');
      await tick();
      expect(played).toHaveLength(2);
      expect(speech).toContainEqual({ turn: 't1', state: 'idle' });
      expect(speech).toContainEqual({ turn: 't2', n: 1, state: 'started' });
    });

    it('a clear that races a sentence still playing says idle once', async () => {
      const { p, finish, speech } = player();
      p.enqueue(sentence(1));
      await tick();
      p.clear();
      finish();
      await tick();
      expect(speech.filter((e) => e.state === 'idle')).toHaveLength(1);
    });

    it('clear of another turn leaves the playing one alone', async () => {
      const { p, played } = player();
      p.enqueue(sentence(1));
      await tick();
      p.clear('t9');
      p.enqueue(sentence(2));
      await tick();
      expect(played).toHaveLength(1);
      expect(p.speaking).toBe(true);
    });
  });
});

describe('applySpeechControl', () => {
  it('maps each action to the player call, passing the turn to clear', () => {
    const player = { pause: vi.fn(), resume: vi.fn(), clear: vi.fn() };
    applySpeechControl(player, { action: 'pause' });
    applySpeechControl(player, { action: 'resume' });
    applySpeechControl(player, { action: 'clear', turn: 't1' });
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.resume).toHaveBeenCalledOnce();
    expect(player.clear).toHaveBeenCalledWith('t1');
  });
});

describe('speakWithSystem', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSpeech() {
    vi.stubGlobal('document', { documentElement: { style: { setProperty: vi.fn() } } });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        rate = 1;
        onend: (() => void) | null = null;
        constructor(readonly text: string) {}
      },
    );
    const spoken: { rate: number; onend: () => void }[] = [];
    vi.stubGlobal('speechSynthesis', {
      speak: (utterance: { rate: number; onend: () => void }) => spoken.push(utterance),
      getVoices: () => [],
      cancel: vi.fn(),
    });
    return spoken;
  }

  it('speaks at the speed asked for', async () => {
    const spoken = stubSpeech();
    const playing = speakWithSystem('Hello there.', new AbortController().signal, 1.3);
    expect(spoken[0]?.rate).toBe(1.3);
    spoken[0]?.onend();
    await playing;
  });
});

describe('previewVoice', () => {
  const line = { text: 'Hello.', mouth: 'kokoro', voice: 'bm_fable', speed: 1.1 } as const;
  const signal = new AbortController().signal;

  it('plays the brain’s sample in the form’s voice and speed', async () => {
    const deps = {
      sample: vi.fn(() => Promise.resolve({ data: 'UklG' })),
      wav: vi.fn(() => Promise.resolve()),
      system: vi.fn(() => Promise.resolve()),
    };
    await previewVoice(line, signal, deps);
    expect(deps.sample).toHaveBeenCalledWith('Hello.', 'bm_fable', 1.1);
    expect(deps.wav).toHaveBeenCalledWith('UklG', signal);
    expect(deps.system).not.toHaveBeenCalled();
  });

  it('uses the system voice when the brain has no sample, and never asks for System voice', async () => {
    const deps = {
      sample: vi.fn(() => Promise.resolve(null)),
      wav: vi.fn(() => Promise.resolve()),
      system: vi.fn(() => Promise.resolve()),
    };
    await previewVoice(line, signal, deps);
    expect(deps.system).toHaveBeenCalledWith('Hello.', signal, 1.1);
    deps.sample.mockClear();
    await previewVoice({ ...line, mouth: 'system' }, signal, deps);
    expect(deps.sample).not.toHaveBeenCalled();
    expect(deps.system).toHaveBeenCalledTimes(2);
  });
});
