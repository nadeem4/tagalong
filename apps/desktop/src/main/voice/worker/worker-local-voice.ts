import type { LocalVoice, SpeakOptions, SpokenAudio } from '../voice';
import type { VoiceWorker } from './client';

/** Kokoro as main sees it: loaded and run in the voice process, never in main. */
export class WorkerLocalVoice implements LocalVoice {
  readonly #worker: Pick<VoiceWorker, 'call' | 'onMessage' | 'onExit'>;
  #ready = false;

  constructor(worker: Pick<VoiceWorker, 'call' | 'onMessage' | 'onExit'>) {
    this.#worker = worker;
    worker.onMessage((message) => {
      if (message.kind === 'kokoro.ready') this.#ready = true;
    });
    worker.onExit(() => {
      this.#ready = false;
    });
  }

  ready(): boolean {
    return this.#ready;
  }

  warm(): void {
    this.#worker.call({ kind: 'call', method: 'kokoro.warm' }).then(
      (ok) => {
        if (ok === true) this.#ready = true;
      },
      (error: unknown) => console.warn('[voice] the local voice could not load', error),
    );
  }

  async speak(text: string, { voice, speed }: SpeakOptions): Promise<SpokenAudio> {
    return (await this.#worker.call({ kind: 'call', method: 'kokoro.speak', text, voice, speed })) as SpokenAudio;
  }
}
