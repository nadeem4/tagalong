import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** One model file: where it comes from, where it lives under the voice folder, its size. */
export interface ModelFile {
  url: string;
  path: string;
  bytes: number;
}

const MOONSHINE = 'https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/main';
const MOONSHINE_DIR = 'onnx-community/moonshine-tiny-ONNX';

/**
 * The ears' models, fetched the first time listening is used (never at start, never in
 * tests). Variant C (no sherpa): Silero VAD, Moonshine through transformers.js, Smart Turn.
 * The Moonshine files sit in the transformers.js cache layout under the voice folder, the
 * cache Kokoro already uses, so the pipeline finds them locally. `bytes` are the sizes Task 0
 * measured; the total is 43,001,836 bytes (about 43 MB).
 */
export const EARS_FILES: readonly ModelFile[] = [
  {
    url: 'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx',
    path: 'ears/silero-vad/model.onnx',
    bytes: 2_243_022,
  },
  {
    url: `${MOONSHINE}/config.json`,
    path: `${MOONSHINE_DIR}/config.json`,
    bytes: 921,
  },
  {
    url: `${MOONSHINE}/generation_config.json`,
    path: `${MOONSHINE_DIR}/generation_config.json`,
    bytes: 147,
  },
  {
    url: `${MOONSHINE}/preprocessor_config.json`,
    path: `${MOONSHINE_DIR}/preprocessor_config.json`,
    bytes: 128,
  },
  {
    url: `${MOONSHINE}/tokenizer.json`,
    path: `${MOONSHINE_DIR}/tokenizer.json`,
    bytes: 3_761_754,
  },
  {
    url: `${MOONSHINE}/tokenizer_config.json`,
    path: `${MOONSHINE_DIR}/tokenizer_config.json`,
    bytes: 135_735,
  },
  {
    url: `${MOONSHINE}/onnx/encoder_model_quantized.onnx`,
    path: `${MOONSHINE_DIR}/onnx/encoder_model_quantized.onnx`,
    bytes: 7_937_661,
  },
  {
    url: `${MOONSHINE}/onnx/decoder_model_merged_quantized.onnx`,
    path: `${MOONSHINE_DIR}/onnx/decoder_model_merged_quantized.onnx`,
    bytes: 20_243_286,
  },
  {
    url: 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx',
    path: 'ears/smart-turn-v3/smart-turn-v3.2-cpu.onnx',
    bytes: 8_679_182,
  },
];

export function filesPresent(dir: string, files: readonly ModelFile[]): boolean {
  return files.every((file) => existsSync(join(dir, file.path)));
}

/**
 * Downloads every file not yet on disk. Each is written beside itself as `.part` and
 * renamed when complete, so a failed or interrupted download leaves nothing that looks done.
 * `bytes` is a minimum, not an exact match: a re-upload a few bytes larger must not break listening.
 * `onProgress` hears the share of all bytes done (present or just fetched) after each file,
 * and ends with exactly 1; with everything already there it hears just that 1.
 */
export async function ensureFiles(
  dir: string,
  files: readonly ModelFile[],
  fetchFn: typeof fetch = fetch,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (filesPresent(dir, files)) {
    onProgress?.(1);
    return;
  }
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  let done = 0;
  for (const file of files) {
    const target = join(dir, file.path);
    if (existsSync(target)) {
      done += file.bytes;
      onProgress?.(Math.min(done / total, 1));
      continue;
    }
    const part = `${target}.part`;
    try {
      const response = await fetchFn(file.url);
      if (!response.ok) throw new Error(`${file.url} answered ${response.status}`);
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength < file.bytes) throw new Error(`${file.path} is incomplete`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(part, body);
      await rename(part, target);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    done += file.bytes;
    onProgress?.(Math.min(done / total, 1));
  }
}

/**
 * `ensureFiles` shared by everything in the voice process that needs the files (the Settings
 * prefetch, the first listen): a caller while a download is under way joins it, hearing its
 * progress from then on, so two never write the same `.part`. A failure lets the next try afresh.
 */
export function sharedEnsureFiles(
  dir: string,
  files: readonly ModelFile[],
  fetchFn: typeof fetch = fetch,
): (onProgress?: (fraction: number) => void) => Promise<void> {
  let running: Promise<void> | null = null;
  const listeners = new Set<(fraction: number) => void>();
  return async (onProgress) => {
    if (onProgress !== undefined) listeners.add(onProgress);
    try {
      running ??= ensureFiles(dir, files, fetchFn, (fraction) => {
        for (const listener of listeners) listener(fraction);
      }).finally(() => (running = null));
      await running;
    } finally {
      if (onProgress !== undefined) listeners.delete(onProgress);
    }
  };
}
