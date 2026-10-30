/**
 * Settings' "Add Scout to your browser" section: how to load the browser add-on with Load
 * unpacked. The add-on dials Scout on its own, so there is nothing to paste; this only
 * finds the folder, reveals it and copies the two addresses people cannot click.
 */
import type { BrowserFolder } from '../../../shared/ipc';
import { Section } from './section';

// A blocked clipboard or a missing folder is not worth a message here, so rejections are dropped.
const copy = (text: string): void => {
  navigator.clipboard.writeText(text).catch(() => undefined);
};

export function BrowserSection({ folder }: { folder: BrowserFolder | null }) {
  return (
    <Section id="browser">
      <p className="tg-help">
        Lets Scout read a tab in Chrome or Edge, only when it needs to and only after you allow it.
      </p>
      <ol className="tg-help">
        <li>
          Open <code>chrome://extensions</code> (or <code>edge://extensions</code>) in your browser.
        </li>
        <li>Turn on Developer mode.</li>
        <li>Choose Load unpacked, then pick the Scout folder.</li>
      </ol>
      {folder === null ? null : folder.exists ? (
        <p className="tg-help">{folder.path}</p>
      ) : (
        <p className="tg-help">Build it first: pnpm --filter @tagalong/browser build</p>
      )}
      <div className="tg-inline">
        {folder?.exists === true && (
          <button
            type="button"
            className="tg-btn-quiet"
            onClick={() => {
              window.tagalongHost.showBrowserFolder().catch(() => undefined);
            }}
          >
            Show folder
          </button>
        )}
        {folder !== null && (
          <button type="button" className="tg-btn-quiet" onClick={() => copy(folder.path)}>
            Copy folder path
          </button>
        )}
        <button type="button" className="tg-btn-quiet" onClick={() => copy('chrome://extensions')}>
          Copy chrome://extensions
        </button>
        <button type="button" className="tg-btn-quiet" onClick={() => copy('edge://extensions')}>
          Copy edge://extensions
        </button>
      </div>
    </Section>
  );
}
