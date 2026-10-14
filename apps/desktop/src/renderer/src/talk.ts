import { useEffect, useRef, useState } from 'react';
import { ListenController, PushToTalk } from '@tagalong/ui';
import type { BubbleTalk, TalkAction } from '@tagalong/ui';
import { openMic } from './mic';
import { RemoteEars } from './remote-ears';

/** A question is never longer than this: the microphone closes on its own after it. */
const MAX_LISTEN_MS = 30_000;

const FIRST_TIME =
  'The first time, Tagalong downloads its speech models (about 43 MB). Speech is turned into text on this PC.';
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
 * its frames stream to the ears in the voice process, the words heard so far show as they
 * come, and letting go hands the question to the bubble. The microphone never opens
 * without one of those two.
 */
export function useTalk(options: TalkOptions): { talk: BubbleTalk; cancel: () => void } {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [ptt] = useState(() => new PushToTalk());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<BubbleTalk['state']>('idle');
  const listening = useRef(false);
  const [note, setNote] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  // The bubble listens for each question heard, and asks it.
  const [hearers] = useState(() => new Set<(text: string) => void>());
  const [onHeard] = useState(() => (handler: (text: string) => void) => {
    hearers.add(handler);
    return () => void hearers.delete(handler);
  });
  // The bubble listens for each start of listening: talking over Scout stops its answer.
  const [listeners] = useState(() => new Set<() => void>());
  const [onListen] = useState(() => (handler: () => void) => {
    listeners.add(handler);
    return () => void listeners.delete(handler);
  });

  const [controller] = useState(() => {
    const bargeIn = (): void => {
      latest.current.onBegin();
      for (const listen of listeners) listen();
    };
    /** A question is over; unless the next one has already started, the bubble goes quiet. */
    const done = (line: string | null): void => {
      if (made.mode !== null) return;
      listening.current = false;
      setPartial(null);
      setState('idle');
      setNote(line);
    };
    const made: ListenController = new ListenController({
      ears: (mode) => new RemoteEars(window.tagalongHost, mode),
      openMic: () => openMic(latest.current.microphoneId),
      onSpeechStart: bargeIn,
      onPartial: setPartial,
      onHeard: (text) => {
        done(null);
        for (const hear of hearers) hear(text);
      },
      onNothingHeard: () => done(NOTHING_HEARD),
      onMicFailed: (error) => {
        console.warn('[talk] the microphone could not be opened', error);
        ptt.end();
        clearTimeout(timer.current);
        done(NO_MICROPHONE);
      },
      // "Scout, stop": switched off as the person would, so main saves it and tells every window.
      onStopListening: () =>
        void window.tagalongHost
          .setListening(false)
          .catch((error: unknown) => console.warn('[talk] listening could not stop', error)),
    });
    return { made, bargeIn };
  });

  const [control] = useState(() => {
    const stop = (): void => {
      clearTimeout(timer.current);
      // Nothing held (a failure already ended it): no question is coming, so never "hearing".
      if (controller.made.mode === null) {
        listening.current = false;
        setState('idle');
        return;
      }
      setState('hearing');
      controller.made.release();
    };
    const act = (action: TalkAction): void => {
      if (action === 'start') {
        controller.bargeIn();
        listening.current = true;
        setState('listening');
        setNote(null);
        setPartial(null);
        controller.made.hold();
        timer.current = setTimeout(() => {
          if (!ptt.listening) return;
          ptt.end();
          stop();
        }, MAX_LISTEN_MS);
      } else if (action === 'stop') stop();
    };
    const cancel = (): void => {
      ptt.end();
      clearTimeout(timer.current);
      controller.made.cancel();
      listening.current = false;
      setPartial(null);
      setState('idle');
    };
    return { act, cancel };
  });

  // The ears' models: the first time they download. A failure ends the question being asked.
  useEffect(
    () =>
      window.tagalongHost.onEarsStatus(({ status, message }) => {
        if (status === 'loading') setNote(FIRST_TIME);
        else if (status === 'ready')
          setNote((current) => (current === FIRST_TIME ? null : current));
        else if (listening.current) {
          control.cancel();
          setNote(message ?? 'Listening stopped. Try again.');
        }
      }),
    [control],
  );

  // Every press of the talk key, repeats included; PushToTalk tells them apart.
  useEffect(() => window.tagalongHost.onTalk((at) => control.act(ptt.press(at))), [control, ptt]);

  // The bubble has the keyboard while the key is held: the first key up means "let go". Every
  // key up goes to PushToTalk, listening or not: it also clears a hold that a failure ended.
  useEffect(() => {
    const up = (): void => control.act(ptt.release());
    window.addEventListener('keyup', up);
    return () => window.removeEventListener('keyup', up);
  }, [control, ptt]);

  return {
    talk: {
      state,
      onHeard,
      onListen,
      note,
      partial,
      keyLabel: options.keyLabel,
      onMic: () => control.act(ptt.click()),
    },
    cancel: control.cancel,
  };
}
