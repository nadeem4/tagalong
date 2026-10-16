/**
 * Kokoro, the local voice: whether it is downloaded, and loading it in the voice process. Contains
 * kokoroDownloaded and loadKokoro.
 */

import { isDownloaded } from './model-cache';
import type { LocalSynth } from './voice';

/** Kokoro-82M (Apache-2.0), as ONNX. The q8 weights are about 92 MB. */
export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** The q8 weights, the largest file a download writes. */
const KOKORO_WEIGHTS = 'onnx/model_quantized.onnx';

/** Whether Kokoro was downloaded on an earlier run, so loading it now fetches nothing. */
export function kokoroDownloaded(cacheDir: string): boolean {
  return isDownloaded(cacheDir, KOKORO_MODEL, KOKORO_WEIGHTS);
}

/**
 * Loads Kokoro on the CPU. `ensure` first makes its files present and matching their pinned
 * hashes (`KOKORO_FILES`, downloaded into `cacheDir` the first time); transformers.js is then
 * told never to fetch anything itself, so it only reads files that were checked. Imported
 * lazily so the app starts without it, and so nothing is downloaded until Scout first speaks.
 * A failure (offline, a damaged download) leaves Scout on the next voice. Never called in
 * tests or under TAGALONG_FAKE_TTS.
 */
export async function loadKokoro(
  cacheDir: string,
  ensure: () => Promise<void>,
): Promise<LocalSynth> {
  await ensure();
  const { env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  env.localModelPath = cacheDir;
  env.allowRemoteModels = false;
  const { KokoroTTS } = await import('kokoro-js');
  return KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: 'q8', device: 'cpu' });
}
