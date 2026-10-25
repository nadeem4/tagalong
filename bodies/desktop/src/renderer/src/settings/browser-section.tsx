/**
 * Settings' Browser extension section: the token the Chrome extension needs, once. Read-only
 * and selectable, with a copy button, because the alternative is asking someone to find a file
 * in their profile folder.
 */
import { useState } from 'react';
import { Section, Tip } from './section';

export function BrowserSection({ token }: { token: string | undefined }) {
  const [copied, setCopied] = useState(false);
  return (
    <Section id="browser" info={{ tip: 'browser', label: 'About the browser extension' }}>
      <p className="tg-help">
        Gives Scout the exact text you highlight in Chrome and the whole page you are on.
      </p>
      <Tip tip="browser">
        Scout already sees Chrome without it, through screenshots and the window&apos;s text. The
        extension adds exact selections, full page text and a Scout panel inside Chrome. It talks
        only to Tagalong on this computer. Paste the token into the extension&apos;s options page
        once. Anyone with the token can talk to Scout from this computer, so keep it to yourself.
      </Tip>
      {token === undefined ? (
        <p className="tg-help">The pairing token appears once the engine is running.</p>
      ) : (
        <div className="tg-inline">
          <label>
            <span>Pairing token</span>
            <input
              name="pairingToken"
              readOnly
              value={token}
              onFocus={(event) => event.currentTarget.select()}
              data-testid="pairing-token"
            />
          </label>
          <button
            type="button"
            className="tg-btn-quiet"
            onClick={() => {
              void navigator.clipboard.writeText(token).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </Section>
  );
}
