/**
 * The "pick up where you left off" card: each project and half-done hand-off with its own
 * Open or Brief again button. Contains PickUpCard. Used by the bubble.
 */

import { useState } from 'react';
import type { PickUpItem, PickUpProject, PickUpReadyParams } from '@tagalong/protocol';
import { useHostBridge } from './host-bridge';

const OPEN_IN: Record<PickUpProject['editor'], string> = {
  vscode: 'Open in VS Code',
  cursor: 'Open in Cursor',
  other: 'Open folder',
};

const LEFT = { unsent: 'not sent', stopped: 'stopped', error: 'did not finish' } as const;

function openLabel(project: PickUpProject): string {
  return project.editor === 'other'
    ? `Open the ${project.name} folder`
    : OPEN_IN[project.editor].replace('Open', `Open ${project.name}`);
}

/**
 * Pick up where you left off: each project and each half-done hand-off with its own button,
 * so every click is the asking. Open reopens the editor through the host, which opens only
 * what this pick-up named; Brief again puts the saved ask on the hand-off card, unsent.
 */
export function PickUpCard({ pickUp, onDone }: { pickUp: PickUpReadyParams; onDone: () => void }) {
  const bridge = useHostBridge();
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const open = async (project: PickUpProject): Promise<void> => {
    setError(null);
    try {
      await bridge.openPickUp?.(project.id);
      setOpened((current) => new Set([...current, project.id]));
    } catch {
      setError(`Could not open ${project.name}.`);
    }
  };
  const rebrief = async (itemId: string): Promise<void> => {
    try {
      await bridge.rebriefPickUp?.(itemId);
      onDone();
    } catch {
      setError('That expert can’t take it now. Check Home’s Experts.');
    }
  };
  const notNow = (): void => {
    void bridge.dismissPickUp?.();
    onDone();
  };

  const row = (item: PickUpItem) =>
    item.kind === 'project' ? (
      <div key={item.id}>
        <dt>{item.name}</dt>
        <dd>
          <small>
            {item.path}
            {item.branch !== undefined ? `, branch ${item.branch}` : ''}
          </small>
          <button
            type="button"
            className="bubble-quiet"
            aria-label={openLabel(item)}
            onClick={() => void open(item)}
          >
            {opened.has(item.id) ? 'Opened' : OPEN_IN[item.editor]}
          </button>
        </dd>
      </div>
    ) : (
      <div key={item.id}>
        <dt>{item.expertName}</dt>
        <dd>
          <span className="handoff-brief">
            {item.expertName}: “{item.ask}” ({LEFT[item.state]})
          </span>
          <button
            type="button"
            className="bubble-quiet"
            aria-label={`Brief ${item.expertName} again`}
            onClick={() => void rebrief(item.id)}
          >
            Brief again
          </button>
        </dd>
      </div>
    );

  return (
    <section className="handoff" aria-label="Pick up where you left off">
      <p className="bubble-text">{pickUp.text}</p>
      <dl className="handoff-rows">{pickUp.items.map(row)}</dl>
      {error !== null && (
        <p role="alert" className="bubble-error">
          {error}
        </p>
      )}
      <div className="bubble-row">
        <button type="button" className="bubble-quiet" onClick={notNow}>
          Not now
        </button>
      </div>
    </section>
  );
}
