/**
 * Scout's voice in a renderer window: prepareLine and playLine play what main synthesised
 * (Kokoro or ElevenLabs) or fall back to the system voice, and onSystemVoice tells the ears
 * when the un-cancellable system voice speaks.
 */
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

let systemSpeaking = false;
const systemListeners = new Set<(speaking: boolean) => void>();

/** Whether the system voice is speaking: the one voice echo cancellation cannot remove. */
export function systemVoiceSpeaking(): boolean {
  return systemSpeaking;
}

/** Hears each start and end of the system voice; the function returned stops listening. */
export function onSystemVoice(listener: (speaking: boolean) => void): () => void {
  systemListeners.add(listener);
  return () => void systemListeners.delete(listener);
}

function setSystemSpeaking(speaking: boolean): void {
  if (systemSpeaking === speaking) return;
  systemSpeaking = speaking;
  for (const listener of [...systemListeners]) listener(speaking);
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
    setSystemSpeaking(true);
    speechSynthesis.speak(utterance);
  }).finally(() => {
    setLevel(0);
    setSystemSpeaking(false);
  });
}

// The system's voice list fills in asynchronously; asking once early has it ready.
if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();

/**
 * Gets one line ready in this window: main starts synthesising it (Kokoro or ElevenLabs)
 * now, and the function returned plays the audio here once it is in, or uses the system
 * voice when main says to. A line that is dropped unplayed is simply never played.
 * `preview` is Settings' ▶ Preview.
 */
export function prepareLine(
  text: string,
  preview?: SpeakPreview,
): (signal: AbortSignal) => Promise<void> {
  const result = window.tagalongHost.speak(text, preview);
  // Nobody may ever play a line got ready ahead; its failure must not go unhandled.
  result.catch(() => undefined);
  return async (signal) => {
    const spoken = await result;
    if (signal.aborted || spoken.kind === 'off') return;
    if (spoken.kind === 'fallback') return speakWithSystem(text, signal, preview?.speed ?? 1);
    return playAudio(spoken.audio, signal);
  };
}

/** Says one line in this window, start to finish. */
export function playLine(text: string, signal: AbortSignal, preview?: SpeakPreview): Promise<void> {
  return prepareLine(text, preview)(signal);
}
