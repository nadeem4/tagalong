/**
 * Scout's voice in a renderer window: SpeechPlayer plays the sentences the brain speaks (its
 * Kokoro audio, or the system voice for text only), and onSystemVoice tells the ears when the
 * un-cancellable system voice speaks.
 */
import type { SpeechChunk } from '../../shared/ipc';

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

/** Plays a decoded buffer through WebAudio, metering it for the indicator, until done or aborted. */
async function playBuffer(buffer: AudioBuffer, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const audio = (context ??= new AudioContext());
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

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The brain's speech: base64 of little-endian 16-bit mono samples at `rate`. */
async function playPcm(pcm: string, rate: number, signal: AbortSignal): Promise<void> {
  const ints = new Int16Array(bytesOf(pcm).buffer);
  context ??= new AudioContext();
  const buffer = context.createBuffer(1, ints.length, rate);
  const floats = buffer.getChannelData(0);
  for (let i = 0; i < ints.length; i += 1) floats[i] = (ints[i] ?? 0) / 32768;
  await playBuffer(buffer, signal);
}

/** A preview WAV from the brain (Settings), base64. */
export async function playWav(base64: string, signal: AbortSignal): Promise<void> {
  context ??= new AudioContext();
  const buffer = await context.decodeAudioData(bytesOf(base64).buffer);
  await playBuffer(buffer, signal);
}

/** Whether the system voice is speaking: the one voice echo cancellation cannot remove. */
let systemSpeaking = false;
const systemListeners = new Set<(speaking: boolean) => void>();

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

/** The system voice: when the brain sends text only, or Settings picks it. */
export function speakWithSystem(text: string, signal: AbortSignal, rate: number): Promise<void> {
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

interface Engines {
  pcm(pcm: string, rate: number, signal: AbortSignal): Promise<void>;
  system(text: string, signal: AbortSignal, rate: number): Promise<void>;
}

interface PlayerOptions {
  /** Defaults to WebAudio and the system voice; tests pass fakes. */
  engines?: Engines;
  /** Who speaks, as Settings has it: the brain's Kokoro audio, or the system voice. */
  mouth: () => 'kokoro' | 'system';
  /** The system voice's speed. */
  rate?: () => number;
  /** Tells the brain to stop speaking. */
  hush: () => void;
  /** Speaking: a sentence is playing or waiting. Answering: the turn's speech is not done yet. */
  onState: (state: { speaking: boolean; answering: boolean }) => void;
}

/**
 * Plays the sentences of a spoken reply one after another as the brain sends them. A sentence
 * with audio plays as audio; text only (Kokoro still loading, or the System voice picked) is
 * said by the system voice.
 */
export class SpeechPlayer {
  private queue: SpeechChunk[] = [];
  private running = false;
  private playing = false;
  private abort = new AbortController();
  /** The turn whose speech has begun and not yet ended. */
  private answeringTurn: string | null = null;
  /** The turn stop() silenced: its late sentences are dropped. */
  private silenced: string | null = null;
  private last = { speaking: false, answering: false };

  constructor(private readonly options: PlayerOptions) {}

  enqueue(chunk: SpeechChunk): void {
    if (chunk.turn === this.silenced) return;
    this.silenced = null;
    this.answeringTurn = chunk.turn;
    this.queue.push(chunk);
    void this.pump();
  }

  /** The brain has no more to say for this turn. */
  done(turn: string): void {
    if (turn !== this.answeringTurn) return;
    this.answeringTurn = null;
    this.emit();
  }

  /** Silences Scout now: this sentence, the rest, and the brain's. */
  stop(): void {
    this.silenced = this.answeringTurn ?? this.queue[0]?.turn ?? this.silenced;
    this.queue = [];
    this.answeringTurn = null;
    this.playing = false;
    this.abort.abort();
    this.abort = new AbortController();
    this.options.hush();
    this.emit();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let chunk = this.queue.shift(); chunk !== undefined; chunk = this.queue.shift()) {
        this.playing = true;
        this.emit();
        try {
          await this.play(chunk, this.abort.signal);
        } catch {
          // A sentence that cannot play is skipped; the next one still speaks.
        }
      }
    } finally {
      this.running = false;
      this.playing = false;
      this.emit();
    }
  }

  private play(chunk: SpeechChunk, signal: AbortSignal): Promise<void> {
    const engines = this.options.engines ?? { pcm: playPcm, system: speakWithSystem };
    if (this.options.mouth() === 'kokoro' && chunk.pcm !== undefined && chunk.sampleRate) {
      return engines.pcm(chunk.pcm, chunk.sampleRate, signal);
    }
    if (chunk.text === undefined) return Promise.resolve();
    return engines.system(chunk.text, signal, this.options.rate?.() ?? 1);
  }

  private emit(): void {
    const next = { speaking: this.playing, answering: this.answeringTurn !== null };
    if (next.speaking === this.last.speaking && next.answering === this.last.answering) return;
    this.last = next;
    this.options.onState(next);
  }
}

/**
 * Settings' Preview: the brain speaks the line in the form's voice and speed; with the System
 * voice picked, or if the brain cannot (Kokoro still loading, brain offline), the system
 * voice says it.
 */
export async function previewVoice(
  line: { text: string; mouth: 'kokoro' | 'system'; voice: string; speed: number },
  signal: AbortSignal,
  deps: {
    sample: (text: string, voice: string, speed: number) => Promise<{ data: string } | null>;
    wav: (base64: string, signal: AbortSignal) => Promise<void>;
    system: (text: string, signal: AbortSignal, rate: number) => Promise<void>;
  } = {
    sample: (text, voice, speed) => window.tagalongHost.speakSample(text, voice, speed),
    wav: playWav,
    system: speakWithSystem,
  },
): Promise<void> {
  const sample =
    line.mouth === 'kokoro' ? await deps.sample(line.text, line.voice, line.speed) : null;
  if (signal.aborted) return;
  if (sample !== null) return deps.wav(sample.data, signal);
  return deps.system(line.text, signal, line.speed);
}
