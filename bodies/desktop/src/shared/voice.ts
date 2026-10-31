/**
 * What only the desktop knows about Scout's voice: the audio format the ears hear, the adapter
 * facts Settings shows, the order mouths are tried in, and which mouth the person picked.
 * The slot interfaces themselves live in `@tagalong/ui/shapes`. Imports nothing but those
 * types, so desktop main, the voice process and the windows all share it.
 */
import type { MouthId } from '@tagalong/ui/shapes';

/** The ears hear 16 kHz mono audio, in frames of this many samples (32 ms). */
export const EARS_SAMPLE_RATE = 16_000;
export const EARS_FRAME = 512;

/** The voice on this computer: what the chosen one falls back to before the system voice. */
export const LOCAL_MOUTH: MouthId = 'kokoro';

/** What a person needs to know before picking an adapter. */
export interface VoiceAdapterFacts {
  id: string;
  slot: 'ears' | 'mouth';
  label: string;
  offline: boolean;
  screenshots: boolean;
}

export const VOICE_ADAPTERS: readonly VoiceAdapterFacts[] = [
  {
    id: 'local',
    slot: 'ears',
    label: 'On this computer',
    offline: true,
    screenshots: false,
  },
  {
    id: 'kokoro',
    slot: 'mouth',
    label: 'Kokoro, on this computer',
    offline: true,
    screenshots: false,
  },
  {
    id: 'system',
    slot: 'mouth',
    label: 'The system voice',
    offline: true,
    screenshots: false,
  },
];

export function adaptersFor(slot: VoiceAdapterFacts['slot']): readonly VoiceAdapterFacts[] {
  return VOICE_ADAPTERS.filter((adapter) => adapter.slot === slot);
}

/** The chosen voice, then the local one, then the system voice, each once. */
export function mouthOrder(chosen: MouthId): MouthId[] {
  return [...new Set<MouthId>([chosen, LOCAL_MOUTH, 'system'])];
}

/** The mouth the person picked; the local voice until they pick another. */
export function chosenMouth(voice: { mouth?: MouthId | undefined }): MouthId {
  return voice.mouth ?? LOCAL_MOUTH;
}
