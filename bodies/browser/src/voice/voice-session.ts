/**
 * The popup's voice session as pure logic: start the brain's ears, forward mic frames, and on
 * the brain's turn_end send what was heard as a spoken question. Listen only: the answer is
 * shown and spoken on the desktop. Everything it touches is passed in, so tests need no Chrome.
 */
import { BrainOffline } from '@tagalong/contract';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'error';

/** What the popup shows: the state, the running words, and the plain error line. */
export interface VoiceView {
  state: VoiceState;
  text: string;
  error: string;
  /** The brain is still downloading its ears (first use); progress is 0 to 1. */
  loading: boolean;
  progress: number;
}

export interface VoiceDeps {
  client: {
    listen(mode: 'held'): Promise<void>;
    mic(pcm: Int16Array): boolean;
    unlisten(): void;
  };
  mic: { start(): Promise<void>; stop(): Promise<void> };
  /** Sends the question as a spoken `say`. */
  say(text: string): Promise<unknown>;
  onChange(view: VoiceView): void;
}

/** How long after "done talking" the brain gets to finish decoding before the popup lets go. */
const TURN_END_WAIT_MS = 10_000;

export interface VoiceSession {
  start(): Promise<void>;
  frame(pcm: Int16Array): void;
  /** The person is done talking; the brain's turn_end carries the words. */
  stop(): void;
  onHeard(event: string, text?: string): void;
  onVoice(status: string, message?: string, progress?: number): void;
  /** The link or the mic went away: ends an active session with a plain reason. */
  end(reason: string): void;
  view(): VoiceView;
}

export function createVoiceSession(deps: VoiceDeps): VoiceSession {
  let current: VoiceView = { state: 'idle', text: '', error: '', loading: false, progress: 0 };
  let waiting: ReturnType<typeof setTimeout> | undefined;
  // True while the spoken question is on its way, so a second turn_end cannot send it twice.
  let sending = false;

  function set(next: Partial<VoiceView>): void {
    current = { ...current, ...next };
    deps.onChange(current);
  }

  // The first use downloads the ears, which can outlast the wait, so the timer waits for them.
  function startWait(): void {
    clearTimeout(waiting);
    waiting = setTimeout(() => set({ state: 'idle' }), TURN_END_WAIT_MS);
  }

  function release(): void {
    clearTimeout(waiting);
    deps.mic.stop().catch(() => undefined);
    deps.client.unlisten();
  }

  function fail(error: string): void {
    release();
    set({ state: 'error', error });
  }

  const active = (): boolean => current.state === 'listening' || current.state === 'thinking';

  return {
    view: () => current,

    async start() {
      if (active()) return;
      set({ state: 'listening', text: '', error: '', loading: false, progress: 0 });
      try {
        await deps.client.listen('held');
      } catch (error) {
        set({
          state: 'error',
          error:
            error instanceof BrainOffline
              ? "Scout's brain is not reachable."
              : "Scout's brain cannot hear yet.",
        });
        return;
      }
      if (current.state !== 'listening') return;
      try {
        await deps.mic.start();
      } catch {
        fail('The microphone could not start.');
        return;
      }
      // Done talking (or a failure) while the page was opening: close what just opened.
      if (current.state !== 'listening') deps.mic.stop().catch(() => undefined);
    },

    frame(pcm) {
      if (current.state === 'listening') deps.client.mic(pcm);
    },

    stop() {
      if (current.state !== 'listening') return;
      release();
      set({ state: 'thinking' });
      if (!current.loading) startWait();
    },

    onHeard(event, text = '') {
      if (event === 'partial' || event === 'final') {
        if (current.state === 'listening') set({ text });
        return;
      }
      if (event !== 'turn_end' || current.state !== 'thinking' || sending) return;
      clearTimeout(waiting);
      const question = text.trim();
      if (question === '') {
        set({ state: 'idle', text: '' });
        return;
      }
      set({ text: question });
      sending = true;
      deps
        .say(question)
        .then(
          () => set({ state: 'idle' }),
          () => set({ state: 'error', error: 'Scout could not take the question.' }),
        )
        .finally(() => {
          sending = false;
        });
    },

    onVoice(status, message, progress) {
      if (!active()) return;
      if (status === 'loading') set({ loading: true, progress: progress ?? current.progress });
      else if (status === 'ready') {
        const wasLoading = current.loading;
        set({ loading: false, progress: 0 });
        if (wasLoading && current.state === 'thinking') startWait();
      } else if (status === 'failed') fail(message ?? "Scout's ears could not start.");
    },

    end(reason) {
      if (active()) fail(reason);
    },
  };
}
