import type { Recognizer } from './listen';
import { loadOrForget } from './model-cache';

/**
 * Whisper base.en (OpenAI, Apache-2.0), as ONNX for Transformers.js. English only, which
 * makes it more accurate than the multilingual model of the same size. The q8 encoder and
 * decoder are about 77 MB together.
 */
export const WHISPER_MODEL = 'onnx-community/whisper-base.en';

type Transcriber = (audio: Float32Array) => Promise<{ text: string } | { text: string }[]>;

/**
 * Loads Whisper on the CPU, downloading the model into `cacheDir` the first time and
 * reading it from there afterwards, next to the voice. Imported lazily so the app starts
 * without it, and nothing is downloaded until Talk to Scout is first used. Never called in
 * tests or under TAGALONG_FAKE_STT.
 */
export async function loadWhisper(cacheDir: string): Promise<Recognizer> {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  // The pipeline's overloads are too much for the checker; this is the call it makes.
  // A failed load deletes the cached model, so a broken download is fetched afresh.
  const transcribe = (await loadOrForget(cacheDir, WHISPER_MODEL, () =>
    pipeline('automatic-speech-recognition', WHISPER_MODEL, { dtype: 'q8', device: 'cpu' }),
  )) as unknown as Transcriber;
  return async (samples) => {
    const result = await transcribe(samples);
    return (Array.isArray(result) ? result.map((part) => part.text).join(' ') : result.text) ?? '';
  };
}
