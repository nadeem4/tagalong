/** Tests that the ONNX ears load from the voice folder with fetching off. */

import { describe, expect, it, vi } from 'vitest';

// Stand-ins for onnxruntime-node and transformers.js: the real ones would load the models.
const env = vi.hoisted(() => ({ cacheDir: '', localModelPath: '', allowRemoteModels: true }));
const seen = vi.hoisted(() => ({ remoteAtLoad: [] as boolean[] }));
vi.mock('@huggingface/transformers', () => ({
  env,
  pipeline: vi.fn(async () => {
    seen.remoteAtLoad.push(env.allowRemoteModels);
    return async () => ({ text: '' });
  }),
}));
vi.mock('onnxruntime-node', () => {
  const ort = {
    InferenceSession: { create: vi.fn(async () => ({ run: vi.fn() })) },
    Tensor: class {},
  };
  return { ...ort, default: ort };
});

import { loadOrtParts } from './ort-ears';

describe('loadOrtParts', () => {
  it('loads Moonshine from the voice folder only, with transformers.js fetching off', async () => {
    await loadOrtParts('/voice');
    expect(seen.remoteAtLoad).toEqual([false]);
    expect(env.localModelPath).toBe('/voice');
    expect(env.cacheDir).toBe('/voice');
  });
});
