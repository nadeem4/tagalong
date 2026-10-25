/** Smart Turn, the end-of-turn model. Voice process only. Contains loadSmartTurn. */

import type { EndOfTurn } from './local-ears';

const SAMPLES = 8 * 16_000;

/**
 * Smart Turn v3.2 (pipecat-ai, BSD-2) on onnxruntime-node: the last 8 s, normalised and
 * left-padded with silence, through Whisper features; the model answers with the probability
 * that the person is done. Loaded in the voice process only; never in tests.
 */
export async function loadSmartTurn(modelPath: string): Promise<EndOfTurn> {
  const mod = await import('onnxruntime-node');
  const ort = mod.default ?? mod;
  const { WhisperFeatureExtractor } = await import('@huggingface/transformers');
  const session = await ort.InferenceSession.create(modelPath, {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
  });
  const extractor = new WhisperFeatureExtractor({
    feature_size: 80,
    sampling_rate: 16_000,
    hop_length: 160,
    n_fft: 400,
    chunk_length: 8,
    n_samples: SAMPLES,
    nb_max_frames: 800,
    padding_value: 0,
  });
  return {
    complete: async (samples) => {
      const tail = samples.subarray(Math.max(0, samples.length - SAMPLES));
      const mean = tail.reduce((sum, v) => sum + v, 0) / (tail.length || 1);
      const variance = tail.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (tail.length || 1);
      const scale = 1 / Math.sqrt(variance + 1e-7);
      const padded = new Float32Array(SAMPLES);
      tail.forEach((v, i) => (padded[SAMPLES - tail.length + i] = (v - mean) * scale));
      const { input_features } = await extractor(padded);
      const output = await session.run({
        [session.inputNames[0]!]: new ort.Tensor(
          'float32',
          input_features.data as Float32Array,
          [1, 80, 800],
        ),
      });
      return Number(output[session.outputNames[0]!]!.data[0]);
    },
  };
}
