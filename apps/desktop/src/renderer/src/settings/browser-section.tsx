import { useState } from 'react';
import { Section } from './section';

/**
 * The token the Chrome extension needs, once. Read-only and selectable, with a copy button,
 * because the alternative is asking someone to find a file in their profile folder.
 */
export function BrowserSection({ token }: { token: string | undefined }) {
  const [copied, setCopied] = useState(false);
  return (
    <Section id="browser">
      {token === undefined ? (
        <p className="tg-note">The pairing token appears once the engine is running.</p>
      ) : (
        <>
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
            {copied ? 'Copied' : 'Copy token'}
          </button>
          <p className="tg-note" style={{ marginTop: 12 }}>
            Paste it into the Tagalong extension&apos;s options page in Chrome. Anyone with this
            token can drive your pets from this computer, so keep it to yourself.
          </p>
        </>
      )}
    </Section>
  );
}
