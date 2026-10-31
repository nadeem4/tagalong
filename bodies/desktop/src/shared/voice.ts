/**
 * What only the desktop knows about Scout's voice: the audio format the ears hear, the adapter
 * facts Settings shows, and which mouth the person picked. The voice itself runs in the brain.
 * The slot interfaces live in `@tagalong/ui/shapes`. Imports nothing but those types.
 */
import type { MouthId } from '@tagalong/ui/shapes';

/** The ears hear 16 kHz mono audio, in frames of this many samples (32 ms). */
export const EARS_SAMPLE_RATE = 16_000;
export const EARS_FRAME = 512;

/** Kokoro, the brain's voice: what is spoken until the person picks the system voice. */
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
    label: 'The brain’s ears',
    offline: true,
    screenshots: false,
  },
  {
    id: 'kokoro',
    slot: 'mouth',
    label: 'Kokoro (on the brain)',
    offline: true,
    screenshots: false,
  },
  {
    id: 'system',
    slot: 'mouth',
    label: 'System voice',
    offline: true,
    screenshots: false,
  },
];

export function adaptersFor(slot: VoiceAdapterFacts['slot']): readonly VoiceAdapterFacts[] {
  return VOICE_ADAPTERS.filter((adapter) => adapter.slot === slot);
}

/** The mouth the person picked; Kokoro until they pick another. */
export function chosenMouth(voice: { mouth?: MouthId | undefined }): MouthId {
  return voice.mouth ?? LOCAL_MOUTH;
}
