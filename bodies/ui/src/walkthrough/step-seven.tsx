/**
 * Walkthrough step 7: let Scout read browser tabs. The three load-unpacked steps with copy
 * buttons for the extensions addresses and the installed add-on folder. Contains StepSeven.
 * Words are the spec's step copy.
 */

import { useEffect, useState } from 'react';
import { Button } from '../controls';
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

  // A copy that fails costs nothing: the address is on screen to type.
  const copy = (text: string) => void host.copyText(text).catch(() => undefined);

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
            <Button variant="quiet" onClick={() => copy('chrome://extensions')}>
              Copy chrome://extensions
            </Button>
            <Button variant="quiet" onClick={() => copy('edge://extensions')}>
              Copy edge://extensions
            </Button>
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
            <Button
              variant="quiet"
              disabled={folder === null}
              onClick={() => folder !== null && copy(folder)}
            >
              Copy folder path
            </Button>
          </div>
        </li>
      </ol>
    </section>
  );
}
