import type { SpeakPreview } from '../../shared/ipc';

/** Names of British male system voices, after George, the one Windows ships. */
const BRITISH_MALE = /\b(ryan|thomas|oliver|arthur|alfie|elliot|ethan|noah)\b/i;

/**
 * The system voice to fall back on: an en-GB male voice when one is installed, George
 * first; otherwise none, which leaves the system's default voice.
 */
export function pickSystemVoice<V extends { name: string; lang: string }>(
  voices: readonly V[],
): V | undefined {
  const british = voices.filter((voice) => voice.lang.replace('_', '-').toLowerCase() === 'en-gb');
  return (
    british.find((voice) => /\bgeorge\b/i.test(voice.name)) ??
    british.find((voice) => BRITISH_MALE.test(voice.name))
  );
}

/** How loud Scout is right now, 0 to 1, for the speaking indicator's CSS. */
function setLevel(level: number): void {
  document.documentElement.style.setProperty('--tg-voice-level', level.toFixed(2));
}

let context: AudioContext | null = null;

/** Plays encoded audio through WebAudio, metering it for the indicator, until done or aborted. */
async function playAudio(bytes: Uint8Array, signal: AbortSignal): Promise<void> {
  context ??= new AudioContext();
  const audio = context;
  const buffer = await audio.decodeAudioData(bytes.slice().buffer);
  if (signal.aborted) return;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const analyser = audio.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyser.connect(audio.destination);
  const samples = new Uint8Array(analyser.fftSize);
  let frame = 0;
  const meter = (): void => {
    analyser.getByteTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
    setLevel(Math.min(1, peak / 64));
    frame = requestAnimationFrame(meter);
  };
  await new Promise<void>((resolve) => {
    const end = (): void => {
      cancelAnimationFrame(frame);
      setLevel(0);
      resolve();
    };
    source.onended = end;
    signal.addEventListener(
      'abort',
      () => {
        source.stop();
        end();
      },
      { once: true },
    );
    source.start();
    meter();
  });
}

/** The system voice, while the local model downloads or if every engine failed. */
function speakWithSystem(text: string, signal: AbortSignal, rate: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const chosen = pickSystemVoice(speechSynthesis.getVoices());
    if (chosen !== undefined) utterance.voice = chosen;
    utterance.rate = rate;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    signal.addEventListener(
      'abort',
      () => {
        speechSynthesis.cancel();
        resolve();
      },
      { once: true },
    );
    setLevel(0.5);
    speechSynthesis.speak(utterance);
  }).finally(() => setLevel(0));
}

// The system's voice list fills in asynchronously; asking once early has it ready.
if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();

/**
 * Says one line in this window: main synthesises it (Kokoro or ElevenLabs) and the audio
 * is played here, or main says to use the system voice. `preview` is Settings' ▶ Preview.
 */
export async function playLine(
  text: string,
  signal: AbortSignal,
  preview?: SpeakPreview,
): Promise<void> {
  const result = await window.tagalongHost.speak(text, preview);
  if (signal.aborted || result.kind === 'off') return;
  if (result.kind === 'fallback') return speakWithSystem(text, signal, preview?.speed ?? 1);
  return playAudio(result.audio, signal);
}
