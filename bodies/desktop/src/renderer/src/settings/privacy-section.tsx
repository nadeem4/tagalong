/**
 * Settings' Privacy section: Seeing and Always listening (live switches), rolling memory on or
 * off with its minutes, and the built-in blind spots, listed from BLIND_SPOTS and never
 * switchable.
 */
import { useEffect, useState } from 'react';
import { BLIND_SPOTS } from '../../../shared/blind-spots';
import { MAX_ROLLING_MEMORY_MINUTES, SETTINGS_DEFAULTS } from '../../../shared/settings';
import type { Settings } from '../../../shared/settings';
import { keyCaps } from '../settings-form';
import { Info, Section, Tip, useInvalid } from './section';

/**
 * Seeing and Always listening act at once, through main, so they are no form fields: each
 * reads its state on mount and follows it when it changes elsewhere (the bubble, the pause
 * key, "Scout, stop").
 */
function LiveSwitches() {
  const [seeing, setSeeing] = useState(true);
  const [listening, setListening] = useState(false);
  useEffect(() => {
    void window.tagalongHost.getSightPaused().then((paused) => setSeeing(!paused));
    return window.tagalongHost.onSightPause((paused) => setSeeing(!paused));
  }, []);
  useEffect(() => {
    void window.tagalongHost.getListening().then((state) => setListening(state.on));
    return window.tagalongHost.onListening((state) => setListening(state.on));
  }, []);
  return (
    <>
      <div className="tg-setting">
        <div className="tg-setting__text">
          <h3 className="tg-sub" id="seeing-label">
            Seeing
          </h3>
          <p className="tg-help">
            Scout can look at your screen when you ask. Off pauses all sight until you turn it back
            on, or until Tagalong restarts.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          className="tg-switch"
          aria-checked={seeing}
          aria-labelledby="seeing-label"
          onClick={() =>
            void window.tagalongHost
              .toggleSightPause()
              .then((p) => setSeeing(!p))
              .catch((error: unknown) => console.warn('[settings] could not switch Seeing', error))
          }
        >
          {seeing ? 'On' : 'Off'}
        </button>
      </div>
      <hr className="tg-divider" />
      <div className="tg-setting">
        <div className="tg-setting__text">
          <h3 className="tg-sub" id="always-listening-label">
            Always listening
          </h3>
          <p className="tg-help">
            Off by default. When on, Scout hears everything said near the computer but only answers
            when you start with &ldquo;Scout&rdquo;. It stays on after a restart until you switch it
            off; a mark on Scout shows the whole time. Audio is understood on this computer and
            never sent or stored.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          className="tg-switch"
          aria-checked={listening}
          aria-labelledby="always-listening-label"
          onClick={() =>
            void window.tagalongHost
              .setListening(!listening)
              .then((state) => setListening(state.on))
              .catch((error: unknown) =>
                console.warn('[settings] could not switch Always listening', error),
              )
          }
        >
          {listening ? 'On' : 'Off'}
        </button>
      </div>
      <hr className="tg-divider" />
    </>
  );
}

/** How long screen memory keeps, beside its switch. Applies only while the switch is on. */
function MemoryMinutes({ minutes }: { minutes: number }) {
  const invalid = useInvalid('rollingMemoryMinutes');
  return (
    <div className="tg-grid tg-grid--narrow">
      <div>
        <label htmlFor={invalid.props.id}>
          <span>Minutes of screen to remember</span>
          <input
            name="rollingMemoryMinutes"
            type="number"
            min={1}
            max={MAX_ROLLING_MEMORY_MINUTES}
            defaultValue={minutes}
            {...invalid.props}
          />
        </label>
        {invalid.message}
      </div>
    </div>
  );
}

export function PrivacySection({ settings, platform }: { settings: Settings; platform: string }) {
  const [remember, setRemember] = useState(settings.rollingMemory.enabled);
  const pauseKey = settings.hotkeys.pauseSight ?? SETTINGS_DEFAULTS.hotkeys.pauseSight;
  return (
    <Section id="privacy">
      <LiveSwitches />
      <div className="tg-setting">
        <div className="tg-setting__text">
          <div className="tg-titlerow">
            <h3 className="tg-sub" id="memory-label">
              Remember the last few minutes of the screen
            </h3>
            <Info tip="memory" label="About screen memory" />
          </div>
          <p className="tg-help">
            So you can ask &ldquo;what was I reading five minutes ago?&rdquo;.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          className="tg-switch"
          aria-checked={remember}
          aria-labelledby="memory-label"
          onClick={() => setRemember((on) => !on)}
        >
          {remember ? 'On' : 'Off'}
        </button>
        {remember && <input type="hidden" name="rollingMemoryEnabled" value="on" />}
      </div>
      <Tip tip="memory">
        Every five seconds Tagalong keeps a small picture of each screen and the list of open
        windows, in memory only. Nothing is written to disk. Pausing sight or quitting throws it all
        away, blind spots are never recorded, and a red dot shows on Scout while it records. Off by
        default.
      </Tip>
      <MemoryMinutes minutes={settings.rollingMemory.minutes} />
      <hr className="tg-divider" />
      <div className="tg-titlerow">
        <h3 className="tg-sub">Scout never looks at</h3>
        <Info tip="blind" label="About what Scout never looks at" />
      </div>
      <p className="tg-help">Built in and always on.</p>
      <ul className="tg-chips">
        {BLIND_SPOTS.map((spot) => (
          <li key={spot.label} className="tg-chip">
            {spot.label}
          </li>
        ))}
      </ul>
      <Tip tip="blind">
        Scout takes no screenshot of these windows, reads none of their text and copies nothing you
        highlight there. Secret files means names like .env, private keys and credential files.
        Anything else that looks like a key, a token, a password or a card number is hidden before
        it leaves this computer, and experts may not open secret files either. These can&apos;t be
        switched off.
      </Tip>
      <p className="tg-help">
        Press{' '}
        {keyCaps(pauseKey, platform).map((part) => (
          <kbd key={part} className="tg-kbd">
            {part}
          </kbd>
        ))}{' '}
        to turn all looking off and on.
      </p>
    </Section>
  );
}
