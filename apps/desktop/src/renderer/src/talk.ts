import { useEffect, useRef, useState } from 'react';
import { ListenController, PushToTalk } from '@tagalong/ui';
import type { BubbleTalk, TalkAction } from '@tagalong/ui';
import { openMic } from './mic';
import { RemoteEars } from './remote-ears';
import { EarsNotes, FailureStreak, micNote, settles, shownPartial } from './talk-rules';
import { onSystemVoice } from './voice-player';

/** A question is never longer than this: the microphone closes on its own after it. */
const MAX_LISTEN_MS = 30_000;

const NOTHING_HEARD = 'I didn’t catch that. Hold the key and try again.';

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
 * come, and letting go hands the question to the bubble. With Always listening switched on
 * (read at mount, so a launch with it on listens from the start) the microphone stays open
 * as well, closed during a call or full screen, with the pets hidden and while the system
 * voice speaks, and only talk that starts with "Scout" is asked; the key and the mic button
 * still ask without the name. The microphone never opens otherwise.
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
  const [note, setNoteState] = useState<string | null>(null);
  // The note shown now, for the ears' status to build on outside a state update.
  const noteNow = useRef<string | null>(null);
  const [setNote] = useState(() => (next: string | null) => {
    noteNow.current = next;
    setNoteState(next);
  });
  const [partial, setPartial] = useState<string | null>(null);
  const [always, setAlwaysState] = useState({ on: false, paused: false });
  // A microphone that cannot open fails again on every always-listening retry: told once.
  const [micFailures] = useState(() => new FailureStreak());
  // The ears failing (offline the first time) fails again at every retry too: said once.
  const [earsNotes] = useState(() => new EarsNotes());
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
      if (!settles(made.mode)) return;
      listening.current = false;
      setPartial(null);
      setState('idle');
      setNote(line);
    };
    const made: ListenController = new ListenController({
      ears: (mode) => new RemoteEars(window.tagalongHost, mode),
      openMic: () => openMic(latest.current.microphoneId),
      onSpeechStart: bargeIn,
      onPartial: (text, mode) => {
        micFailures.clear();
        setPartial(shownPartial(text, mode));
      },
      onHeard: (text) => {
        micFailures.clear();
        done(null);
        for (const hear of hearers) hear(text);
      },
      onNothingHeard: () => done(NOTHING_HEARD),
      onMicFailed: (error) => {
        ptt.end();
        clearTimeout(timer.current);
        if (!micFailures.fail()) return;
        console.warn('[talk] the microphone could not be opened', error);
        done(micNote(error));
      },
      // "Scout, stop": switched off as the person would, so main saves it and tells every window.
      onStopListening: () =>
        void window.tagalongHost
          .setListening(false)
          .catch((error: unknown) => console.warn('[talk] listening could not stop', error)),
      onDropped: () => setPartial(null),
    });
    return { made, bargeIn };
  });

  const [control] = useState(() => {
    const stop = (): void => {
      clearTimeout(timer.current);
      // Nothing held (a failure ended it, or Scout listens all the time): no question is
      // coming, so never "hearing".
      if (settles(controller.made.mode)) {
        listening.current = false;
        setState('idle');
        return;
      }
      setState('hearing');
      controller.made.release();
    };
    const act = (action: TalkAction): void => {
      if (action === 'start') {
        // Listening all the time too: the key still asks, without the name, then it resumes.
        micFailures.clear();
        earsNotes.clear();
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
    /** No question is pending any more: the bubble goes quiet. */
    const quiet = (): void => {
      ptt.end();
      clearTimeout(timer.current);
      listening.current = false;
      setPartial(null);
      setState('idle');
    };
    // The bubble closed: the question goes, always listening goes on.
    const cancel = (): void => {
      controller.made.cancel();
      quiet();
    };
    return { act, cancel, quiet };
  });

  // The ears' models: the first time they download. A failure ends the question being asked,
  // and the always session until the next switch, call or system voice tries again.
  useEffect(
    () =>
      window.tagalongHost.onEarsStatus(({ status, message }) => {
        if (status !== 'failed') {
          setNote(earsNotes.status(noteNow.current, status));
          return;
        }
        const asking = listening.current;
        if (controller.made.earsFailed() !== 'always' && !asking) return;
        control.quiet();
        setNote(earsNotes.failed(noteNow.current, message));
      }),
    [control, controller, earsNotes, setNote],
  );

  // Always listening, as switched in the bubble or Settings, and paused for a call.
  useEffect(() => {
    const apply = (next: { on: boolean; paused: boolean }): void => {
      setAlwaysState(next);
      // Paused first: switched on during a call, the mic must not open for a moment.
      controller.made.setPaused(next.paused);
      controller.made.setAlways(next.on);
    };
    void window.tagalongHost
      .getListening()
      .then(apply)
      .catch((error: unknown) => console.warn('[talk] could not read Always listening', error));
    return window.tagalongHost.onListening(apply);
  }, [controller]);

  // The system voice is not echo-cancelled: the ears stay deaf while it speaks.
  useEffect(() => onSystemVoice((speaking) => controller.made.setDeaf(speaking)), [controller]);

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
      always: {
        ...always,
        onToggle: () =>
          void window.tagalongHost
            .setListening(!always.on)
            .catch((error: unknown) => console.warn('[talk] could not switch listening', error)),
      },
    },
    cancel: control.cancel,
  };
}
