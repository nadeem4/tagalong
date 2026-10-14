import { useEffect, useRef, useState } from 'react';
import { PushToTalk } from '@tagalong/ui';
import type { BubbleTalk, TalkAction } from '@tagalong/ui';
import { startRecording } from './mic';
import type { Recording } from './mic';

/** A question is never longer than this: the microphone closes on its own after it. */
const MAX_LISTEN_MS = 30_000;

const FIRST_TIME =
  'The first time, Tagalong downloads its speech model (about 80 MB). Speech is turned into text on this PC.';
const NOTHING_HEARD = 'I didn’t catch that. Hold the key and try again.';
const NO_MICROPHONE =
  'The microphone could not be opened. Check that Windows lets apps use it, or pick another in Settings.';

export interface TalkOptions {
  /** The talk key as a person reads it. */
  keyLabel: string;
  /** The microphone picked in Settings; empty or absent for the system default. */
  microphoneId: string | undefined;
  /** Listening starts: Scout stops talking at once and the bubble comes up. */
  onBegin: () => void;
}

/**
 * Talk to Scout in the panel: the talk key (held) or the mic button opens the microphone,
 * letting go sends what was said to main to be turned into text, and the bubble asks it.
 * The microphone never opens without one of those two.
 */
export function useTalk(options: TalkOptions): { talk: BubbleTalk; cancel: () => void } {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [ptt] = useState(() => new PushToTalk());
  const recording = useRef<Promise<Recording | null> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<BubbleTalk['state']>('idle');
  const [note, setNote] = useState<string | null>(null);
  // The bubble listens for each question heard, and asks it.
  const [hearers] = useState(() => new Set<(text: string) => void>());
  const [onHeard] = useState(() => (handler: (text: string) => void) => {
    hearers.add(handler);
    return () => void hearers.delete(handler);
  });

  const [control] = useState(() => {
    const begin = (): void => {
      latest.current.onBegin();
      setState('listening');
      setNote(null);
      window.tagalongHost
        .prepareListening()
        .then(({ ready }) => {
          if (!ready) setNote(FIRST_TIME);
        })
        .catch((error: unknown) => console.warn('[talk] could not prepare listening', error));
      recording.current = startRecording(latest.current.microphoneId).catch((error: unknown) => {
        console.warn('[talk] the microphone could not be opened', error);
        ptt.end();
        setState('idle');
        setNote(NO_MICROPHONE);
        return null;
      });
      timer.current = setTimeout(() => {
        if (!ptt.listening) return;
        ptt.end();
        void finish();
      }, MAX_LISTEN_MS);
    };

    const finish = async (): Promise<void> => {
      clearTimeout(timer.current);
      const pending = recording.current;
      recording.current = null;
      const recorder = pending === null ? null : await pending;
      if (recorder === null) {
        setState('idle');
        return;
      }
      setState('hearing');
      try {
        const result = await window.tagalongHost.transcribe(await recorder.stop());
        if (result.kind === 'failed') setNote(result.message);
        else if (result.text === '') setNote(NOTHING_HEARD);
        else {
          setNote(null);
          for (const hear of hearers) hear(result.text);
        }
      } catch (error) {
        console.warn('[talk] what was said could not be heard', error);
        setNote('That could not be turned into text. Try again.');
      } finally {
        setState('idle');
      }
    };

    const act = (action: TalkAction): void => {
      if (action === 'start') begin();
      else if (action === 'stop') void finish();
    };

    const cancel = (): void => {
      if (!ptt.listening && recording.current === null) return;
      ptt.end();
      clearTimeout(timer.current);
      const pending = recording.current;
      recording.current = null;
      void pending?.then((recorder) => recorder?.cancel());
      setState('idle');
    };

    return { act, cancel };
  });

  // Every press of the talk key, repeats included; PushToTalk tells them apart.
  useEffect(() => window.tagalongHost.onTalk((at) => control.act(ptt.press(at))), [control, ptt]);

  // The bubble has the keyboard while the key is held: the first key up means "let go".
  useEffect(() => {
    const up = (): void => {
      if (ptt.listening) control.act(ptt.release());
    };
    window.addEventListener('keyup', up);
    return () => window.removeEventListener('keyup', up);
  }, [control, ptt]);

  return {
    talk: {
      state,
      onHeard,
      note,
      keyLabel: options.keyLabel,
      onMic: () => control.act(ptt.click()),
    },
    cancel: control.cancel,
  };
}
