/**
 * What the voice picker (Settings and the tour) reads of the brain's speaking voices (tts_state):
 * the roster, the choice and the current download. Contains parseTtsState, TtsState and
 * TtsVoiceRow; shaped after tts_tools in brain/src/brain/voice/tts_tools.py.
 */
import { z } from 'zod';

const Voice = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  descriptor: z.string(),
  engine: z.string().min(1),
  size_mb: z.number(),
  licence: z.string(),
  installed: z.boolean(),
  sample: z.boolean(),
});

const Wire = z.object({
  chosen: z.string().min(1),
  resolved: z.string().min(1),
  voices: z.array(Voice),
  download: z.object({
    voice: z.string(),
    status: z.enum(['idle', 'downloading', 'ready', 'failed']),
    progress: z.number().min(0).max(1),
  }),
});

export type TtsState = z.infer<typeof Wire>;
export type TtsVoiceRow = z.infer<typeof Voice>;

export function parseTtsState(json: unknown): TtsState {
  return Wire.parse(json);
}
