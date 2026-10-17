/** Tests for the voice process's ears. */

import { describe, expect, it, vi } from 'vitest';
import { EARS_FRAME } from '@tagalong/protocol';
import {
  createEarsHost,
  EARS_DOWNLOAD_FAILED,
  EARS_MODEL_DAMAGED,
  EARS_START_FAILED,
} from './ears-host';
import { ModelIntegrityError } from '../ears/model-files';
import type { EarsParts } from '../ears/local-ears';
import type { FromWorker } from './messages';

const LOUD = new Float32Array(EARS_FRAME).fill(0.3);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await tick();
};
const earsEvents = (posted: FromWorker[]) =>
  posted.flatMap((m) =>
    m.kind === 'ears' ? [m.text === undefined ? m.event : `${m.event}:${m.text}`] : [],
  );

function partsOnce() {
  return vi.fn(async () => ({
    vad: { accept: async (f: Float32Array) => f[0] !== 0 },
    stt: { accept: () => undefined, text: async () => 'hello there', reset: () => undefined },
    turn: { complete: async () => 1 },
  }));
}

describe('the ears’ failure messages', () => {
  it('are neutral status lines, never Scout speaking', () => {
    expect(EARS_DOWNLOAD_FAILED).toBe(
      'Speech models didn’t download. Check the internet connection.',
    );
    expect(EARS_MODEL_DAMAGED).toBe('The speech model download was damaged. Check the connection.');
    expect(EARS_START_FAILED).toBe('Listening couldn’t start. It retries on its own.');
  });
});

describe('createEarsHost', () => {
  it('loads the models once, keeps the first words heard while loading, and posts each event', async () => {
    const posted: FromWorker[] = [];
    const load = partsOnce();
    const host = createEarsHost({ fake: false, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    await tick();
    host({ kind: 'ears.stop' });
    await tick();
    expect(posted[0]).toEqual({ kind: 'ears.status', status: 'loading' });
    expect(posted).toContainEqual({ kind: 'ears.status', status: 'ready' });
    expect(posted).toContainEqual({ kind: 'ears', event: 'speechStart' });
    expect(posted.at(-1)).toEqual({ kind: 'ears', event: 'turnEnd', text: 'hello there' });

    host({ kind: 'ears.listen', mode: 'held' });
    await tick();
    expect(load).toHaveBeenCalledOnce();
  });

  it('keeps the words when the key is released before the models have loaded', async () => {
    const posted: FromWorker[] = [];
    let release: (parts: EarsParts) => void = () => undefined;
    const load = vi.fn(() => new Promise<EarsParts>((resolve) => (release = resolve)));
    const host = createEarsHost({ fake: false, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    host({ kind: 'ears.stop' });
    release(await partsOnce()());
    await tick();
    await tick();
    expect(posted.at(-1)).toEqual({ kind: 'ears', event: 'turnEnd', text: 'hello there' });
  });

  it('never wires a session that a second listen replaced during the load', async () => {
    const posted: FromWorker[] = [];
    let release: (parts: EarsParts) => void = () => undefined;
    const load = vi.fn(() => new Promise<EarsParts>((resolve) => (release = resolve)));
    const host = createEarsHost({ fake: false, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    host({ kind: 'ears.listen', mode: 'held' });
    release(await partsOnce()());
    await tick();
    expect(posted.filter((m) => m.kind === 'ears')).toEqual([]);
    expect(posted.filter((m) => m.kind === 'ears.status' && m.status === 'ready')).toHaveLength(1);
  });

  it('hears one session at a time when a listen follows a stop during the load', async () => {
    const posted: FromWorker[] = [];
    let release: (parts: EarsParts) => void = () => undefined;
    const load = vi.fn(() => new Promise<EarsParts>((resolve) => (release = resolve)));
    const host = createEarsHost({ fake: false, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    host({ kind: 'ears.stop' });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    release(await partsOnce()());
    await settle();
    host({ kind: 'ears.stop' });
    await settle();
    expect(earsEvents(posted)).toEqual([
      'speechStart',
      'final:hello there',
      'turnEnd:hello there',
      'speechStart',
      'final:hello there',
      'turnEnd:hello there',
    ]);
  });

  it('hears one session at a time when a listen follows a held stop at once', async () => {
    const posted: FromWorker[] = [];
    const host = createEarsHost({ fake: false, load: partsOnce(), post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'held' });
    await tick();
    host({ kind: 'ears.frame', samples: LOUD });
    await tick();
    host({ kind: 'ears.stop' });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    await settle();
    host({ kind: 'ears.stop' });
    await settle();
    expect(earsEvents(posted)).toEqual([
      'speechStart',
      'final:hello there',
      'turnEnd:hello there',
      'speechStart',
      'final:hello there',
      'turnEnd:hello there',
    ]);
  });

  it('hears the frames still queued behind a slow decode when the key is released', async () => {
    const posted: FromWorker[] = [];
    let words = 0;
    const decodes: (() => void)[] = [];
    const parts: EarsParts = {
      vad: { accept: async (f) => f[0] !== 0 },
      stt: {
        accept: (f) => void (f[0] !== 0 && (words += 1)),
        // A slow decode, as Moonshine's live words take a few hundred ms: done when the test says.
        text: () =>
          new Promise<string>((resolve) =>
            decodes.push(() => resolve(Array(words).fill('w').join(' '))),
          ),
        reset: () => void (words = 0),
      },
      turn: { complete: async () => 1 },
    };
    const host = createEarsHost({
      fake: false,
      load: async () => parts,
      post: (m) => posted.push(m),
    });
    host({ kind: 'ears.listen', mode: 'held' });
    for (let i = 0; i < 10; i += 1) host({ kind: 'ears.frame', samples: LOUD });
    await settle();
    // The tenth frame is waiting on live words; six more arrive, then the key comes up.
    for (let i = 0; i < 6; i += 1) host({ kind: 'ears.frame', samples: LOUD });
    host({ kind: 'ears.stop' });
    for (let i = 0; i < 20; i += 1) {
      await tick();
      decodes.splice(0).forEach((decode) => decode());
    }
    const ends = earsEvents(posted).filter((e) => e.startsWith('turnEnd'));
    expect(ends).toEqual([`turnEnd:${Array(16).fill('w').join(' ')}`]);
  });

  it('keeps the order when a session is skipped between two others', async () => {
    const posted: FromWorker[] = [];
    const seen: string[] = [];
    let closeA: (words: string) => void = () => undefined;
    let texts = 0;
    const parts: EarsParts = {
      vad: { accept: async (f) => f[0] !== 0 },
      stt: {
        accept: () => undefined,
        text: () => {
          texts += 1;
          if (texts === 1) return new Promise<string>((resolve) => (closeA = resolve));
          return Promise.resolve('second');
        },
        reset: () => void seen.push('reset'),
      },
      turn: { complete: async () => 1 },
    };
    const host = createEarsHost({
      fake: false,
      load: async () => parts,
      post: (m) => posted.push(m),
    });
    host({ kind: 'ears.listen', mode: 'held' });
    await settle();
    host({ kind: 'ears.frame', samples: LOUD });
    await settle();
    host({ kind: 'ears.listen', mode: 'held' }); // A is stopped, its words still being read
    host({ kind: 'ears.listen', mode: 'held' }); // B skipped
    host({ kind: 'ears.frame', samples: LOUD });
    await settle();
    expect(earsEvents(posted)).toEqual(['speechStart']);
    closeA('first');
    await settle();
    host({ kind: 'ears.stop' });
    await settle();
    expect(earsEvents(posted)).toEqual([
      'speechStart',
      'final:first',
      'turnEnd:first',
      'speechStart',
      'final:second',
      'turnEnd:second',
    ]);
  });

  it('ends a stopped session whose drain fails, and the next listen still works', async () => {
    const posted: FromWorker[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let first = true;
    const parts: EarsParts = {
      vad: {
        accept: async (f) => {
          if (first) {
            first = false;
            throw new Error('vad broke');
          }
          return f[0] !== 0;
        },
      },
      stt: { accept: () => undefined, text: async () => 'again', reset: () => undefined },
      turn: { complete: async () => 1 },
    };
    let release: (parts: EarsParts) => void = () => undefined;
    const load = () => new Promise<EarsParts>((resolve) => (release = resolve));
    const host = createEarsHost({ fake: false, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    host({ kind: 'ears.stop' });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    release(parts);
    await settle();
    host({ kind: 'ears.stop' });
    await settle();
    expect(earsEvents(posted)).toEqual(['turnEnd:', 'speechStart', 'final:again', 'turnEnd:again']);
  });

  it('posts one turn end when the models fail mid-hold and the key is released after', async () => {
    const posted: FromWorker[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    const parts: EarsParts = {
      vad: {
        accept: async (f) => {
          calls += 1;
          if (calls === 2) throw new Error('vad broke');
          return f[0] !== 0;
        },
      },
      stt: { accept: () => undefined, text: async () => 'hello there', reset: () => undefined },
      turn: { complete: async () => 1 },
    };
    const host = createEarsHost({
      fake: false,
      load: async () => parts,
      post: (m) => posted.push(m),
    });
    host({ kind: 'ears.listen', mode: 'held' });
    await settle();
    host({ kind: 'ears.frame', samples: LOUD });
    host({ kind: 'ears.frame', samples: LOUD });
    await settle();
    host({ kind: 'ears.stop' });
    await settle();
    expect(earsEvents(posted).filter((e) => e.startsWith('turnEnd'))).toEqual([
      'turnEnd:hello there',
    ]);
  });

  it('says listening failed when a model breaks while always listening, and loads again next time', async () => {
    const posted: FromWorker[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: EarsParts = {
      vad: {
        accept: async () => {
          throw new Error('silero broke');
        },
      },
      stt: { accept: () => undefined, text: async () => '', reset: () => undefined },
      turn: { complete: async () => 1 },
    };
    const load = vi.fn().mockResolvedValueOnce(broken).mockImplementation(partsOnce());
    const host = createEarsHost({
      fake: false,
      load,
      post: (m) => posted.push(m),
      filesPresent: () => true,
    });
    host({ kind: 'ears.listen', mode: 'always' });
    await settle();
    host({ kind: 'ears.frame', samples: LOUD });
    await settle();
    expect(posted.filter((m) => m.kind === 'ears.status' && m.status === 'failed')).toEqual([
      { kind: 'ears.status', status: 'failed', message: EARS_START_FAILED },
    ]);
    host({ kind: 'ears.stop' });
    host({ kind: 'ears.listen', mode: 'always' });
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ends a held question with what was heard when a model breaks, without saying listening failed', async () => {
    const posted: FromWorker[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: EarsParts = {
      vad: {
        accept: async () => {
          throw new Error('silero broke');
        },
      },
      stt: { accept: () => undefined, text: async () => '', reset: () => undefined },
      turn: { complete: async () => 1 },
    };
    const host = createEarsHost({
      fake: false,
      load: vi.fn().mockResolvedValue(broken),
      post: (m) => posted.push(m),
      filesPresent: () => true,
    });
    host({ kind: 'ears.listen', mode: 'held' });
    await settle();
    host({ kind: 'ears.frame', samples: LOUD });
    await settle();
    expect(posted.some((m) => m.kind === 'ears.status' && m.status === 'failed')).toBe(false);
    expect(earsEvents(posted)).toEqual(['turnEnd:']);
  });

  it('says listening failed when the ears cannot be built, and loads again next time', async () => {
    const posted: FromWorker[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unbuildable: EarsParts = {
      vad: { accept: async () => false },
      stt: {
        accept: () => undefined,
        text: async () => '',
        reset: () => {
          throw new Error('moonshine session gone');
        },
      },
      turn: { complete: async () => 1 },
    };
    const load = vi.fn().mockResolvedValueOnce(unbuildable).mockImplementation(partsOnce());
    const host = createEarsHost({
      fake: false,
      load,
      post: (m) => posted.push(m),
      filesPresent: () => true,
    });
    host({ kind: 'ears.listen', mode: 'always' });
    await settle();
    expect(posted).toContainEqual({
      kind: 'ears.status',
      status: 'failed',
      message: EARS_START_FAILED,
    });
    host({ kind: 'ears.listen', mode: 'always' });
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('says plainly when the models cannot download, and tries again next time', async () => {
    const posted: FromWorker[] = [];
    const load = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockImplementation(partsOnce());
    const host = createEarsHost({ fake: false, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'always' });
    await tick();
    expect(posted).toContainEqual({
      kind: 'ears.status',
      status: 'failed',
      message: EARS_DOWNLOAD_FAILED,
    });
    expect(JSON.stringify(posted)).not.toContain('fetch failed');
    host({ kind: 'ears.listen', mode: 'always' });
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('says the model was damaged when a download fails its checksum twice, and tries again next time', async () => {
    const posted: FromWorker[] = [];
    const load = vi
      .fn()
      .mockRejectedValueOnce(new ModelIntegrityError('ears/vad.onnx'))
      .mockImplementation(partsOnce());
    const host = createEarsHost({ fake: false, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'always' });
    await tick();
    expect(posted).toContainEqual({
      kind: 'ears.status',
      status: 'failed',
      message: EARS_MODEL_DAMAGED,
    });
    host({ kind: 'ears.listen', mode: 'always' });
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('says plainly when models already on disk cannot start', async () => {
    const posted: FromWorker[] = [];
    const load = vi.fn().mockRejectedValueOnce(new Error('onnx: bad model'));
    const host = createEarsHost({
      fake: false,
      load,
      post: (m) => posted.push(m),
      filesPresent: () => true,
    });
    host({ kind: 'ears.listen', mode: 'held' });
    await tick();
    expect(posted).toEqual([{ kind: 'ears.status', status: 'failed', message: EARS_START_FAILED }]);
  });

  it('says the first-time download only when the models are not on disk yet', async () => {
    const posted: FromWorker[] = [];
    const host = createEarsHost({
      fake: false,
      load: partsOnce(),
      post: (m) => posted.push(m),
      filesPresent: () => true,
    });
    host({ kind: 'ears.listen', mode: 'held' });
    await tick();
    expect(posted).not.toContainEqual({ kind: 'ears.status', status: 'loading' });
    expect(posted).toContainEqual({ kind: 'ears.status', status: 'ready' });
  });

  it('uses the fake ears under TAGALONG_FAKE_STT, and loads nothing', async () => {
    const posted: FromWorker[] = [];
    const load = partsOnce();
    const host = createEarsHost({ fake: true, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    await tick();
    host({ kind: 'ears.stop' });
    await tick();
    expect(load).not.toHaveBeenCalled();
    expect(posted.filter((m) => m.kind === 'ears' && m.event === 'turnEnd')).toHaveLength(1);
    expect(posted.at(-1)).toEqual({
      kind: 'ears',
      event: 'turnEnd',
      text: 'What am I looking at?',
    });
  });
});
