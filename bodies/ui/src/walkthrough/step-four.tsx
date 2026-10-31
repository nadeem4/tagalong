/**
 * Walkthrough step 4: asking about what is in front of you. Shows the ask key (changeable,
 * saved only on Next), the pause key and the apps Scout never reads. Contains StepFour and
 * showAccelerator. Words are the spec's step copy.
 */

import { useState } from 'react';
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
      <div className="wt-grid">
        <div>
          {changing ? (
            <>
              <label htmlFor="wt-ask">Ask key</label>
              <input id="wt-ask" value={ask} onChange={(event) => setAsk(event.target.value)} />
              <p className="wt-help">Use CommandOrControl, Shift, Alt and a key, joined with +.</p>
            </>
          ) : (
            <>
              <span className="wt-label">Ask key</span>
              <div className="wt-row">
                <span className="wt-kbd">{showAccelerator(ask)}</span>
                <button type="button" className="wt-quiet" onClick={() => setChanging(true)}>
                  Change
                </button>
              </div>
            </>
          )}
        </div>
        {pause !== undefined && (
          <div>
            <span className="wt-label">Pause sight</span>
            <span className="wt-kbd">{showAccelerator(pause)}</span>
            <p className="wt-help">
              Scout reads nothing until you press it again. It’s in the tray menu too.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

export function StepFour({ host }: { host: WalkthroughHost }) {
  const { settings, failed } = useWalkthroughSettings(host);
  return (
    <section>
      <h1>Ask about whatever is in front of you</h1>
      <p className="wt-lead">
        Press the ask key anywhere. Scout’s bubble opens with the text you selected and the window
        you’re on. Remove anything you’d rather not send.
      </p>
      <div className="wt-cols">
        <div>{settings !== null && <AskForm host={host} settings={settings} />}</div>
        <div aria-hidden="true">
          <span className="wt-label">What it looks like</span>
          <div className="wt-example">
            <span className="wt-chip">Chrome · Pricing – Stripe</span>
            <p>“2.9% + 30¢”</p>
            <p>What would this cost on 400 orders a month?</p>
            <span className="wt-fake-button">Open full chat</span>{' '}
            <span className="wt-fake-button">Ask</span>
            <p>Seeing</p>
          </div>
        </div>
      </div>
      {failed && (
        <p className="wt-error" role="alert">
          Scout could not read your settings.
        </p>
      )}
      <div style={{ marginTop: 24 }}>
        <span className="wt-label">Never seen</span>
        <ul className="wt-chips">
          {NEVER_SEEN.map((name) => (
            <li key={name} className="wt-tag">
              {name}
            </li>
          ))}
        </ul>
        <p className="wt-help">
          Always on. Add your own apps in Home, under Settings &gt; Privacy.
        </p>
      </div>
    </section>
  );
}
