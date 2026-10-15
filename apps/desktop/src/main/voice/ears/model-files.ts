import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * One model file: where it comes from (a URL pinned to one Hugging Face commit), where it
 * lives under the voice folder, its exact size, and its SHA-256. The hashes were read once
 * from the Hugging Face tree API for that commit (the LFS `oid` for large files; the small
 * JSON files hashed at that commit and checked against their git blob id) and are written
 * here as constants: they are never fetched at run time. Bumping a model means new hashes.
 */
export interface ModelFile {
  url: string;
  path: string;
  bytes: number;
  sha256: string;
}

/** A downloaded model file did not match its pinned SHA-256, twice in a row. */
export class ModelIntegrityError extends Error {
  constructor(path: string) {
    super(`${path} was damaged: its checksum does not match`);
    this.name = 'ModelIntegrityError';
  }
}

const HF = 'https://huggingface.co';
const SILERO = `${HF}/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec`;
const MOONSHINE_DIR = 'onnx-community/moonshine-tiny-ONNX';
const MOONSHINE = `${HF}/${MOONSHINE_DIR}/resolve/a6da1241cd305dcd64eab1edbd615f2bb9aabb95`;
const SMART_TURN = `${HF}/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93`;
const KOKORO_DIR = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO = `${HF}/${KOKORO_DIR}/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231`;

/**
 * The ears' models, fetched the first time listening is used (never at start, never in
 * tests). Variant C (no sherpa): Silero VAD, Moonshine through transformers.js, Smart Turn.
 * The Moonshine files sit in the transformers.js cache layout under the voice folder, the
 * cache Kokoro uses too, so the pipeline finds them locally. The total is 43,001,836 bytes
 * (about 43 MB).
 */
export const EARS_FILES: readonly ModelFile[] = [
  {
    url: `${SILERO}/onnx/model.onnx`,
    path: 'ears/silero-vad/model.onnx',
    bytes: 2_243_022,
    sha256: 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808',
  },
  {
    url: `${MOONSHINE}/config.json`,
    path: `${MOONSHINE_DIR}/config.json`,
    bytes: 921,
    sha256: '558e1e02069137c796ace1e50c48d8fe451f04a295929138e6bea885517f0edb',
  },
  {
    url: `${MOONSHINE}/generation_config.json`,
    path: `${MOONSHINE_DIR}/generation_config.json`,
    bytes: 147,
    sha256: 'f9b3f711b57be7def2e50a8942f64f36ee0a55fad5b84ff93a687b6c5bcc1d44',
  },
  {
    url: `${MOONSHINE}/preprocessor_config.json`,
    path: `${MOONSHINE_DIR}/preprocessor_config.json`,
    bytes: 128,
    sha256: 'fa43a7017ef85cd1d0fba0d9aae77c8adb16990ae6f11115631f41ec5d8aa679',
  },
  {
    url: `${MOONSHINE}/tokenizer.json`,
    path: `${MOONSHINE_DIR}/tokenizer.json`,
    bytes: 3_761_754,
    sha256: '7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f',
  },
  {
    url: `${MOONSHINE}/tokenizer_config.json`,
    path: `${MOONSHINE_DIR}/tokenizer_config.json`,
    bytes: 135_735,
    sha256: 'edaee394565d428ea98a663ae7209cdcfeefc5585c42d7a570ff7c986df2cd15',
  },
  {
    url: `${MOONSHINE}/onnx/encoder_model_quantized.onnx`,
    path: `${MOONSHINE_DIR}/onnx/encoder_model_quantized.onnx`,
    bytes: 7_937_661,
    sha256: 'c6fc4b7bc5af75c0591fd157a1f3829b533d18e9769a888fd95a62e470dd4f4a',
  },
  {
    url: `${MOONSHINE}/onnx/decoder_model_merged_quantized.onnx`,
    path: `${MOONSHINE_DIR}/onnx/decoder_model_merged_quantized.onnx`,
    bytes: 20_243_286,
    sha256: 'eed87831c3a6103534aae7d47a5d485025c659a1323901513961c39fe8a1a367',
  },
  {
    url: `${SMART_TURN}/smart-turn-v3.2-cpu.onnx`,
    path: 'ears/smart-turn-v3/smart-turn-v3.2-cpu.onnx',
    bytes: 8_679_182,
    sha256: '2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f',
  },
];

/**
 * Kokoro-82M's files (q8), fetched the first time Scout speaks with it, into the same
 * transformers.js cache layout. Its voices come from the kokoro-js npm package, which the
 * lockfile covers. The total is 92,364,770 bytes (about 92 MB).
 */
export const KOKORO_FILES: readonly ModelFile[] = [
  {
    url: `${KOKORO}/config.json`,
    path: `${KOKORO_DIR}/config.json`,
    bytes: 44,
    sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
  },
  {
    url: `${KOKORO}/tokenizer.json`,
    path: `${KOKORO_DIR}/tokenizer.json`,
    bytes: 3_497,
    sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34',
  },
  {
    url: `${KOKORO}/tokenizer_config.json`,
    path: `${KOKORO_DIR}/tokenizer_config.json`,
    bytes: 113,
    sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20',
  },
  {
    url: `${KOKORO}/onnx/model_quantized.onnx`,
    path: `${KOKORO_DIR}/onnx/model_quantized.onnx`,
    bytes: 92_361_116,
    sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478',
  },
];

/** Whether every file is on disk: a look only, never a hash (enough to say "downloading"). */
export function filesPresent(dir: string, files: readonly ModelFile[]): boolean {
  return files.every((file) => existsSync(join(dir, file.path)));
}

/** The SHA-256 of a file on disk, read in pieces so a 92 MB model is never held whole. */
async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Whether the file is on disk with its pinned hash; a damaged copy is deleted. */
async function verified(target: string, file: ModelFile): Promise<boolean> {
  if (!existsSync(target)) return false;
  if ((await sha256OfFile(target)) === file.sha256) return true;
  await rm(target, { force: true });
  return false;
}

/**
 * Fetches one file, keeping it only when its SHA-256 matches. The body is streamed to
 * `<file>.part` and hashed as it arrives, so it is never held whole in memory, and it is
 * renamed into place only once it matches: bad bytes never sit at the final path. A bad copy
 * is deleted and fetched once more; a second bad copy throws `ModelIntegrityError`. A
 * refused or failed request throws at once and leaves no `.part`.
 */
async function download(target: string, file: ModelFile, fetchFn: typeof fetch): Promise<void> {
  const part = `${target}.part`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchFn(file.url);
    if (!response.ok) throw new Error(`${file.url} answered ${response.status}`);
    await mkdir(dirname(target), { recursive: true });
    const hash = createHash('sha256');
    try {
      const out = await open(part, 'w');
      try {
        const reader = response.body?.getReader();
        for (let next = await reader?.read(); next && !next.done; next = await reader?.read()) {
          hash.update(next.value);
          await out.write(next.value);
        }
      } finally {
        await out.close();
      }
      if (hash.digest('hex') !== file.sha256) {
        await rm(part, { force: true });
        continue;
      }
      await rename(part, target);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    return;
  }
  throw new ModelIntegrityError(file.path);
}

/**
 * Makes every file present and matching its pinned hash: files on disk are hashed, a
 * damaged one is deleted and fetched again, a missing one is fetched. `onProgress` hears the
 * share of all bytes done after each file (files already good count from the start), and
 * ends with exactly 1; with everything already good it hears just that 1.
 */
export async function ensureFiles(
  dir: string,
  files: readonly ModelFile[],
  fetchFn: typeof fetch = fetch,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const missing: ModelFile[] = [];
  for (const file of files) if (!(await verified(join(dir, file.path), file))) missing.push(file);
  if (missing.length === 0) {
    onProgress?.(1);
    return;
  }
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  let done = total - missing.reduce((sum, file) => sum + file.bytes, 0);
  if (done > 0) onProgress?.(done / total);
  for (const file of missing) {
    await download(join(dir, file.path), file, fetchFn);
    done += file.bytes;
    onProgress?.(Math.min(done / total, 1));
  }
}

/**
 * `ensureFiles` shared by everything in the voice process that needs the files (the Settings
 * prefetch, the first listen): a caller while a download is under way joins it, hearing its
 * progress from then on, so two never write the same `.part`. Once the files have been
 * checked they are not hashed again in this process. A failure lets the next try afresh.
 */
export function sharedEnsureFiles(
  dir: string,
  files: readonly ModelFile[],
  fetchFn: typeof fetch = fetch,
): (onProgress?: (fraction: number) => void) => Promise<void> {
  let running: Promise<void> | null = null;
  let checked = false;
  const listeners = new Set<(fraction: number) => void>();
  return async (onProgress) => {
    if (checked) {
      onProgress?.(1);
      return;
    }
    if (onProgress !== undefined) listeners.add(onProgress);
    try {
      running ??= ensureFiles(dir, files, fetchFn, (fraction) => {
        for (const listener of listeners) listener(fraction);
      })
        .then(() => {
          checked = true;
        })
        .finally(() => (running = null));
      await running;
    } finally {
      if (onProgress !== undefined) listeners.delete(onProgress);
    }
  };
}
