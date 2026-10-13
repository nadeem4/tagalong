import type { Tts } from './voice';

/** ElevenLabs' low-latency model, made for real-time speech. */
export const ELEVENLABS_MODEL = 'eleven_flash_v2_5';

/** ElevenLabs' own bounds on `voice_settings.speed`. */
const MIN_SPEED = 0.7;
const MAX_SPEED = 1.2;

/**
 * Speech from ElevenLabs, with the person's own key and a voice from their library. Only
 * the line being spoken is sent: never the screen, the question or the conversation.
 */
export function elevenLabsTts(apiKey: string, voiceId: string, fetchFn: typeof fetch = fetch): Tts {
  return {
    speak: async (text, { speed }) => {
      const response = await fetchFn(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
          '?output_format=mp3_44100_128',
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: ELEVENLABS_MODEL,
            voice_settings: { speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed)) },
          }),
        },
      );
      if (!response.ok) throw new Error(`ElevenLabs answered ${response.status}`);
      return { audio: new Uint8Array(await response.arrayBuffer()), mime: 'audio/mpeg' };
    },
  };
}
