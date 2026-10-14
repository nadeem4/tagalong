import { loadOrForget } from './model-cache';
import type { LocalSynth } from './voice';

/** Kokoro-82M (Apache-2.0), as ONNX. The q8 weights are about 90 MB. */
export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * Loads Kokoro on the CPU, downloading the model into `cacheDir` the first time and
 * reading it from there afterwards. Imported lazily so the app starts without it, and so
 * nothing is downloaded until Scout first speaks. Never called in tests or under
 * TAGALONG_FAKE_TTS.
 */
export async function loadKokoro(cacheDir: string): Promise<LocalSynth> {
  const { env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  const { KokoroTTS } = await import('kokoro-js');
  // A failed load deletes the cached model, so a broken download is fetched afresh.
  return loadOrForget(cacheDir, KOKORO_MODEL, () =>
    KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: 'q8', device: 'cpu' }),
  );
}
