/**
 * Settings' Privacy section: Seeing and Always listening (live switches) and the built-in
 * blind spots, listed from BLIND_SPOTS and never switchable.
 */
import { useEffect, useState } from 'react';
import { BLIND_SPOTS } from '../../../shared/blind-spots';
import { SETTINGS_DEFAULTS } from '../../../shared/settings';
import type { Settings } from '../../../shared/settings';
import { keyCaps } from '../settings-form';
import { Info, Section, Tip } from './section';

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

export function PrivacySection({ settings, platform }: { settings: Settings; platform: string }) {
  const pauseKey = settings.hotkeys.pauseSight ?? SETTINGS_DEFAULTS.hotkeys.pauseSight;
  return (
    <Section id="privacy">
      <LiveSwitches />
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
