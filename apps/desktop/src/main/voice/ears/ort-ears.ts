import { join } from 'node:path';
import type { StreamingStt, Vad } from './local-ears';

const FRAME = 512;
const CONTEXT = 64;

/**
 * Silero v5 on onnxruntime-node and Moonshine through Transformers.js: one ONNX runtime.
 * `dir` is the voice folder, the same transformers.js cache Kokoro uses, so Moonshine's files
 * sit under `<dir>/onnx-community/moonshine-tiny-ONNX`. Loaded in the voice process only.
 */
export async function loadOrtParts(dir: string): Promise<{ vad: Vad; stt: StreamingStt }> {
  const mod = await import('onnxruntime-node');
  const ort = mod.default ?? mod;
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = dir;
  const silero = await ort.InferenceSession.create(join(dir, 'ears/silero-vad/model.onnx'), {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
  let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([16_000n]), []);
  const context = new Float32Array(CONTEXT);
  const transcribe = (await pipeline(
    'automatic-speech-recognition',
    'onnx-community/moonshine-tiny-ONNX',
    {
      dtype: 'q8',
      device: 'cpu',
    },
  )) as unknown as (audio: Float32Array) => Promise<{ text: string }>;
  let buffered: Float32Array[] = [];
  // Decodes run one after another: text() may be asked again while an earlier one is pending.
  let decoding: Promise<unknown> = Promise.resolve();
  return {
    vad: {
      accept: async (frame) => {
        const input = new Float32Array(CONTEXT + FRAME);
        input.set(context);
        input.set(frame, CONTEXT);
        context.set(frame.subarray(FRAME - CONTEXT));
        const out = await silero.run({
          input: new ort.Tensor('float32', input, [1, CONTEXT + FRAME]),
          state,
          sr,
        });
        state = out.stateN as typeof state;
        return Number(out.output!.data[0]) >= 0.5;
      },
    },
    stt: {
      accept: (frame) => void buffered.push(frame),
      text: () => {
        const samples = new Float32Array(buffered.length * FRAME);
        buffered.forEach((f, i) => samples.set(f, i * FRAME));
        const run = decoding.then(async () =>
          samples.length === 0 ? '' : (await transcribe(samples)).text.trim(),
        );
        decoding = run.catch(() => undefined);
        return run;
      },
      reset: () => {
        buffered = [];
      },
    },
  };
}
