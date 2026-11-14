/**
 * What Settings' Voice page reads of the brain's voice download (voice_download): the state and
 * how far it has got. Contains parseVoiceDownload and VoiceDownload; shaped after
 * voice_tools in brain/src/brain/tools.py.
 */
import { z } from 'zod';

const Wire = z.object({
  status: z.enum(['idle', 'downloading', 'ready', 'failed']),
  progress: z.number().min(0).max(1),
});

export type VoiceDownload = z.infer<typeof Wire>;

export function parseVoiceDownload(json: unknown): VoiceDownload {
  return Wire.parse(json);
}
