/**
 * MicTest: "Test your microphone", the same in the walkthrough and Settings. Off until pressed;
 * while on it watches the picked microphone and shows its level, and it stops on a second press,
 * on a new device choice, on unmount and (when asked) when the window loses focus. The sound
 * stays in the window: nothing is recorded or sent.
 */
import { useEffect, useState } from 'react';
import { Button } from './button';
import { LevelMeter } from './level-meter';

type Failure = 'denied' | 'busy' | 'no-mic';

/** Starts reading the microphone's level; stop() releases it. */
export type MicWatcher = (
  deviceId: string | undefined,
  onLevel: (level: number) => void,
  onError: (reason: Failure) => void,
) => { stop(): void };

const FAILURE_LINES: Record<Failure, string> = {
  denied:
    'Scout is not allowed to use the microphone. Allow it in Windows settings, then try again.',
  busy: 'The microphone is in use by another app. Close it there, then try again.',
  'no-mic': 'Scout could not open a microphone. Check it is plugged in, then try again.',
};

export function MicTest({
  watch,
  deviceId,
  stopOnBlur = false,
}: {
  watch: MicWatcher;
  deviceId?: string | undefined;
  stopOnBlur?: boolean;
}) {
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    if (!on) return;
    setLevel(0);
    const watching = watch(deviceId, setLevel, (reason) => {
      setFailure(reason);
      setOn(false);
    });
    return () => watching.stop();
  }, [on, deviceId, watch]);

  useEffect(() => {
    if (!on || !stopOnBlur) return;
    const stop = (): void => setOn(false);
    window.addEventListener('blur', stop);
    return () => window.removeEventListener('blur', stop);
  }, [on, stopOnBlur]);

  return (
    <div className="tg-mictest">
      <div className="tg-mictest__row">
        <Button
          variant="secondary"
          onClick={() => {
            setFailure(null);
            setOn(!on);
          }}
        >
          {on ? 'Stop test' : 'Test your microphone'}
        </Button>
        {on && <LevelMeter level={level} />}
      </div>
      <p className="tg-mictest__help">Nothing is recorded or sent. Speak and the bar moves.</p>
      {failure !== null && (
        <p className="tg-mictest__error" role="alert">
          {FAILURE_LINES[failure]}
        </p>
      )}
    </div>
  );
}
