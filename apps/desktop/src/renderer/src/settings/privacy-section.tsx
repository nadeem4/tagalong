import { useState } from 'react';
import { BLIND_SPOTS, SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { keyCaps } from '../settings-form';
import { Info, Section, Tip } from './section';

/**
 * Rolling memory's on/off, and what Scout never looks at. The blind spots are built in and
 * always on, so they are listed from `BLIND_SPOTS` and nothing here can switch them off.
 * The minutes rolling memory keeps are under Advanced.
 */
export function PrivacySection({ settings, platform }: { settings: Settings; platform: string }) {
  const [remember, setRemember] = useState(settings.rollingMemory.enabled);
  const pauseKey = settings.hotkeys.pauseSight ?? SETTINGS_DEFAULTS.hotkeys.pauseSight;
  return (
    <Section id="privacy">
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
