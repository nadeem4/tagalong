/**
 * Walkthrough step 7: let Scout read browser tabs. The three load-unpacked steps with copy
 * buttons for the extensions addresses and the installed add-on folder. Contains StepSeven.
 * Words are the spec's step copy.
 */

import { useEffect, useState } from 'react';
import { Button, CopyButton } from '../controls';
import type { WalkthroughHost } from './walkthrough-host';

type Host = Pick<WalkthroughHost, 'browserFolder' | 'showBrowserFolder' | 'copyText'>;

export function StepSeven({ host }: { host: Host }) {
  const [folder, setFolder] = useState<string | null>(null);
  const { browserFolder } = host;

  useEffect(() => {
    browserFolder().then(
      (found) => setFolder(found.path),
      () => setFolder(null),
    );
  }, [browserFolder]);

  return (
    <section>
      <span className="wt-label">Browser</span>
      <h1>Let Scout read your browser tabs</h1>
      <p className="wt-lead">
        With the add-on in Chrome or Edge, Scout can read the tab you’re on, find a page in your
        history or tidy your tabs. It asks the first time it needs each thing.
      </p>
      <ol className="wt-facts wt-numbered">
        <li>
          <h3>Open your browser’s extensions page</h3>
          <p>Paste the address into the address bar.</p>
          <div className="wt-row">
            <CopyButton variant="quiet" text="chrome://extensions" copy={host.copyText}>
              Copy chrome://extensions
            </CopyButton>
            <CopyButton variant="quiet" text="edge://extensions" copy={host.copyText}>
              Copy edge://extensions
            </CopyButton>
          </div>
        </li>
        <li>
          <h3>Turn on Developer mode</h3>
          <p>It’s a switch at the top right (Chrome) or on the left (Edge).</p>
        </li>
        <li>
          <h3>Choose Load unpacked, then pick this folder</h3>
          {folder !== null && <code className="wt-code">{folder}</code>}
          <div className="wt-row" style={{ marginTop: 8 }}>
            <Button
              variant="quiet"
              onClick={() => void host.showBrowserFolder().catch(() => undefined)}
            >
              Show folder
            </Button>
            <CopyButton
              variant="quiet"
              text={folder ?? ''}
              copy={host.copyText}
              disabled={folder === null}
            >
              Copy folder path
            </CopyButton>
          </div>
        </li>
      </ol>
    </section>
  );
}
