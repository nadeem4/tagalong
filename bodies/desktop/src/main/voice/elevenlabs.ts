/** Speech from ElevenLabs with the person's own key. Contains elevenLabsTts. */

import { MAX_ELEVENLABS_SPEED, MIN_VOICE_SPEED } from '@tagalong/protocol';
import type { Tts } from './voice';

/** ElevenLabs' low-latency model, made for real-time speech. */
export const ELEVENLABS_MODEL = 'eleven_flash_v2_5';

/** How long one line may take, the audio included, before the local voice takes over. */
export const ELEVENLABS_TIMEOUT_MS = 15_000;

/**
 * Speech from ElevenLabs, with the person's own key and a voice from their library. Only
 * the line being spoken is sent: never the screen, the question or the conversation.
 */
export function elevenLabsTts(
  apiKey: string,
  voiceId: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = ELEVENLABS_TIMEOUT_MS,
): Tts {
  return {
    speak: async (text, { speed }) => {
      // A hung request throws like a refused one, and the local voice says the line instead.
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await fetchFn(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
          '?output_format=mp3_44100_128',
        {
          method: 'POST',
          signal,
          headers: {
            'xi-api-key': apiKey,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: ELEVENLABS_MODEL,
            voice_settings: {
              speed: Math.min(MAX_ELEVENLABS_SPEED, Math.max(MIN_VOICE_SPEED, speed)),
            },
          }),
        },
      );
      if (!response.ok) throw new Error(`ElevenLabs answered ${response.status}`);
      return { audio: new Uint8Array(await response.arrayBuffer()), mime: 'audio/mpeg' };
    },
  };
}
