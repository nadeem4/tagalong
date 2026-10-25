/** Tests that Kokoro loads from checked files with fetching off. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stand-ins for transformers.js and kokoro-js: the real ones would load a 92 MB model.
const env = vi.hoisted(() => ({
  cacheDir: '',
  localModelPath: '',
  allowRemoteModels: true,
}));
const fromPretrained = vi.hoisted(() => vi.fn());
vi.mock('@huggingface/transformers', () => ({ env }));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: fromPretrained } }));

import { KOKORO_MODEL, loadKokoro } from './kokoro';

beforeEach(() => {
  env.cacheDir = '';
  env.localModelPath = '';
  env.allowRemoteModels = true;
  fromPretrained.mockReset();
});

describe('loadKokoro', () => {
  it('checks the files first, then loads them from the voice folder with fetching off', async () => {
    const order: string[] = [];
    const synth = { generate: vi.fn() };
    fromPretrained.mockImplementation(async () => {
      order.push(`load remote=${String(env.allowRemoteModels)} from=${env.localModelPath}`);
      return synth;
    });
    const ensure = vi.fn(async () => void order.push('ensure'));
    await expect(loadKokoro('/voice', ensure)).resolves.toBe(synth);
    expect(order).toEqual(['ensure', 'load remote=false from=/voice']);
    expect(fromPretrained).toHaveBeenCalledWith(KOKORO_MODEL, { dtype: 'q8', device: 'cpu' });
  });

  it('never loads the model when its files fail their check', async () => {
    const ensure = vi.fn(async () => {
      throw new Error('damaged');
    });
    await expect(loadKokoro('/voice', ensure)).rejects.toThrow('damaged');
    expect(fromPretrained).not.toHaveBeenCalled();
  });
});
