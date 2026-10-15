import { useEffect, useState } from 'react';
import {
  BLIND_SPOTS,
  MAX_SIGHT_LOG_DAYS,
  MIN_SIGHT_LOG_DAYS,
  SETTINGS_DEFAULTS,
} from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
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

/**
 * How long Home's What Scout saw keeps its rows. Always on, so there is no switch: the log
 * holds no pixels and no text, only what was looked at and where it went.
 */
function SightLogDays({ days }: { days: number }) {
  const invalid = useInvalid('sightLogDays');
  return (
    <>
      <div className="tg-setting">
        <div className="tg-setting__text">
          <div className="tg-titlerow">
            <h3 className="tg-sub">Keep the record of what Scout saw</h3>
            <Info tip="sightLog" label="About the record of what Scout saw" />
          </div>
          <p className="tg-help">Days, from 1 to 30. Home shows it under What Scout saw.</p>
          {invalid.message}
        </div>
        <input
          name="sightLogDays"
          type="number"
          min={MIN_SIGHT_LOG_DAYS}
          max={MAX_SIGHT_LOG_DAYS}
          defaultValue={days}
          aria-label="Days to keep the record of what Scout saw"
          style={{ width: 72 }}
          {...invalid.props}
        />
      </div>
      <Tip tip="sightLog">
        Each time Scout lists your windows, reads text, takes a screenshot, or sends something to an
        AI or an expert, Home notes the kind, the app and window, where it went and how much. Never
        the picture, the text or the brief. Blind spots and your exclusions are noted by app only.
        Older entries are deleted, and deleting one does not take back what was already sent. Always
        on. Kept 7 days by default.
      </Tip>
    </>
  );
}

/**
 * Seeing and Always listening (live), the hello on launch, keeping an eye on things, gentle nudges, rolling memory's on/off, and what Scout
 * never looks at. The blind
 * spots are built in and always on, so they are listed from `BLIND_SPOTS` and nothing here
 * can switch them off.
 * The minutes rolling memory keeps are under Advanced.
 */
export function PrivacySection({ settings, platform }: { settings: Settings; platform: string }) {
  const [remember, setRemember] = useState(settings.rollingMemory.enabled);
  const [greet, setGreet] = useState(settings.greeting);
  const [watching, setWatching] = useState(settings.keepAnEye);
  const [picking, setPicking] = useState(settings.pickUp);
  const [nudging, setNudging] = useState(settings.wellbeing.enabled);
  const pauseKey = settings.hotkeys.pauseSight ?? SETTINGS_DEFAULTS.hotkeys.pauseSight;
  return (
    <Section id="privacy">
      <LiveSwitches />
      <div className="tg-setting">
        <div className="tg-setting__text">
          <div className="tg-titlerow">
            <h3 className="tg-sub" id="greeting-label">
              Say hello when Tagalong opens
            </h3>
            <Info tip="greeting" label="About the hello" />
          </div>
          <p className="tg-help">One short line beside Scout, then it fades.</p>
        </div>
        <button
          type="button"
          role="switch"
          className="tg-switch"
          aria-checked={greet}
          aria-labelledby="greeting-label"
          onClick={() => setGreet((on) => !on)}
        >
          {greet ? 'On' : 'Off'}
        </button>
        {greet && <input type="hidden" name="greeting" value="on" />}
      </div>
      <Tip tip="greeting">
        Scout looks at nothing on screen for this. It knows only the time of day, how long since
        Tagalong last opened, and which hand-offs finished meanwhile. The summaries model writes the
        line in one short call; if that fails, Scout says a line of its own. On by default.
      </Tip>
      <hr className="tg-divider" />
      <div className="tg-setting">
        <div className="tg-setting__text">
          <div className="tg-titlerow">
            <h3 className="tg-sub" id="keep-an-eye-label">
              Keep an eye on things
            </h3>
            <Info tip="keepAnEye" label="About keeping an eye on things" />
          </div>
          <p className="tg-help">Now and then, one useful line. Most of the time, nothing.</p>
        </div>
        <button
          type="button"
          role="switch"
          className="tg-switch"
          aria-checked={watching}
          aria-labelledby="keep-an-eye-label"
          onClick={() => setWatching((on) => !on)}
        >
          {watching ? 'On' : 'Off'}
        </button>
        {watching && <input type="hidden" name="keepAnEye" value="on" />}
      </div>
      <Tip tip="keepAnEye">
        Scout follows which windows are open and which one is in front, from their titles only: no
        picture, no model call. When you settle on a new window for half a minute, or a title reads
        like an error or a failed build, Scout reads that one window&apos;s text and asks the
        summaries model, in one short call, whether there is one useful thing to say. At most one
        line every ten minutes, never twice about the same window, and nothing while a full-screen
        app or a call is in front. Not now on the line quiets it for an hour. Blind spots are never
        considered, titles included. The same titles make Scout wince when a build fails and cheer
        when tests pass, with no read and no model call. Off means no tracking at all. On by
        default.
      </Tip>
      <hr className="tg-divider" />
      <div className="tg-setting">
        <div className="tg-setting__text">
          <div className="tg-titlerow">
            <h3 className="tg-sub" id="wellbeing-label">
              Gentle nudges
            </h3>
            <Info tip="wellbeing" label="About gentle nudges" />
          </div>
          <p className="tg-help">After a long stretch or late at night, Scout suggests a break.</p>
        </div>
        <button
          type="button"
          role="switch"
          className="tg-switch"
          aria-checked={nudging}
          aria-labelledby="wellbeing-label"
          onClick={() => setNudging((on) => !on)}
        >
          {nudging ? 'On' : 'Off'}
        </button>
        {nudging && <input type="hidden" name="wellbeing" value="on" />}
      </div>
      <Tip tip="wellbeing">
        Once a minute Scout reads how long since your last key press or click, and the window titles
        it already gets for keeping an eye: no picture, no text, no model call. After an hour and a
        half with no five-minute break, Scout looks tired and suggests a stretch, once. After 23:00,
        once you have been at it for half an hour, it says it is late, once a night, and offers to
        have your expert write up where you are; nothing runs until you press Send on the card.
        Nothing appears during a call, over a full-screen app or while sight is paused. Not now
        quiets it for an hour. Nothing leaves this computer unless you take the offer. Off by
        default.
      </Tip>
      <hr className="tg-divider" />
      <div className="tg-setting">
        <div className="tg-setting__text">
          <div className="tg-titlerow">
            <h3 className="tg-sub" id="pick-up-label">
              Pick up where you left off
            </h3>
            <Info tip="pickUp" label="About picking up where you left off" />
          </div>
          <p className="tg-help">Back after a long break, one line on what you were in.</p>
        </div>
        <button
          type="button"
          role="switch"
          className="tg-switch"
          aria-checked={picking}
          aria-labelledby="pick-up-label"
          onClick={() => setPicking((on) => !on)}
        >
          {picking ? 'On' : 'Off'}
        </button>
        {picking && <input type="hidden" name="pickUp" value="on" />}
      </div>
      <Tip tip="pickUp">
        Every ten minutes Scout notes, from window titles only, which projects you have open in your
        editor (folder, branch and file name) and which hand-offs are unsent or stopped. One such
        note is kept, on this computer. When you are back after six hours or more, Scout says one
        line about it, once; each item on the card opens only when you click it, and Brief again
        only fills in the hand-off card. Blind spots are never noted. Off deletes the note. On by
        default.
      </Tip>
      <hr className="tg-divider" />
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
      <SightLogDays days={settings.sightLog.days} />
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
