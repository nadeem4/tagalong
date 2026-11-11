/**
 * Walkthrough step 4: asking about what is in front of you. Shows the ask key as keycaps
 * (changeable, saved only on Next), the pause key, a static preview of the bubble and the
 * apps Scout never reads. Contains StepFour and showAccelerator.
 */

import { useState } from 'react';
import { Shortcut } from '../controls';
import { useStepSave, useWalkthroughSettings } from './use-step-save';
import type { WalkthroughHost, WalkthroughSettings } from './walkthrough-host';

/** An accelerator as a person reads it: Electron's CommandOrControl is Ctrl on Windows. */
export function showAccelerator(accelerator: string): string {
  return accelerator.replace('CommandOrControl', 'Ctrl');
}

const NEVER_SEEN = [
  'Password managers',
  'Windows sign-in prompts',
  '.env and SSH keys',
  'Private browsing',
  'Authenticator apps',
  'Remote Desktop',
];

function AskForm({
  host,
  settings,
}: {
  host: Pick<WalkthroughHost, 'saveSettings'>;
  settings: WalkthroughSettings;
}) {
  const saved = settings.hotkeys.ask;
  const [ask, setAsk] = useState(saved);
  const [changing, setChanging] = useState(false);
  const pause = settings.hotkeys.pauseSight;

  useStepSave(async () => {
    const next = ask.trim();
    if (next === saved) return;
    if (next === '') throw new Error('Enter a key combination for the ask key.');
    // A patch replaces the whole hotkeys object, so the others go with it.
    await host.saveSettings({ hotkeys: { ...settings.hotkeys, ask: next } });
  });

  return (
    <>
      <div className="wt-keyrow">
        {changing ? (
          <>
            <label htmlFor="wt-ask">Ask key</label>
            <input id="wt-ask" value={ask} onChange={(event) => setAsk(event.target.value)} />
            <p className="wt-help">Use Ctrl, Shift, Alt and a key, joined with +.</p>
          </>
        ) : (
          <>
            <span className="wt-label">Ask key</span>
            <div className="tg-card wt-keybox">
              <span data-testid="wt-ask-key">
                <Shortcut accelerator={ask} />
              </span>
              <button type="button" className="wt-quiet" onClick={() => setChanging(true)}>
                Change
              </button>
            </div>
            <p className="wt-help">Works in any app. Scout opens with your selection.</p>
          </>
        )}
      </div>
      {pause !== undefined && (
        <div className="wt-keyrow">
          <span className="wt-label">Pause key</span>
          <div className="tg-card wt-keybox">
            <span data-testid="wt-pause-key">
              <Shortcut accelerator={pause} />
            </span>
          </div>
          <p className="wt-help">
            Scout reads nothing until you press it again. It’s in the tray menu too.
          </p>
        </div>
      )}
    </>
  );
}

export function StepFour({ host }: { host: WalkthroughHost }) {
  const { settings, failed } = useWalkthroughSettings(host);
  return (
    <section>
      <span className="wt-label">Asking</span>
      <h1>Ask about whatever is in front of you</h1>
      <p className="wt-lead">
        Press the ask key anywhere. Scout’s bubble opens beside what you’re working on. Remove
        anything you’d rather not send.
      </p>
      <div className="wt-cols">
        <div>{settings !== null && <AskForm host={host} settings={settings} />}</div>
        <div aria-hidden="true" data-testid="wt-bubble-preview">
          <span className="wt-label">What you’ll see</span>
          <div className="wt-bubble">
            <span className="wt-bubble__chip">Chrome · Acme pricing</span>
            <span className="wt-bubble__field">Which plan fits a team of five?</span>
            <div className="wt-bubble__row">
              <span className="wt-bubble__quiet">Open full chat</span>
              <span className="wt-bubble__hint">Enter to ask</span>
              <span className="wt-bubble__ask">Ask</span>
            </div>
          </div>
        </div>
      </div>
      {failed && (
        <p className="wt-error" role="alert">
          Scout could not read your settings.
        </p>
      )}
      <div className="wt-never">
        <span className="wt-label">Scout never looks at</span>
        <ul className="wt-chips wt-chips--apps">
          {NEVER_SEEN.map((name) => (
            <li key={name} className="wt-chip-app">
              {name}
            </li>
          ))}
        </ul>
        <p className="wt-help">
          Built in and always on. Add your own apps in Home, under Settings &gt; Privacy.
        </p>
      </div>
    </section>
  );
}
