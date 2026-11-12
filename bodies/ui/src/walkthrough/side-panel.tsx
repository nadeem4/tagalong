/**
 * The walkthrough's navy side: Scout's still mark, the "Scout" wordmark, the eleven steps (only
 * those already reached can be jumped to) and the footnote. Contains SidePanel.
 */

import { ScoutGlyph } from '../scout-mark';
import { STEPS } from './steps';

interface SidePanelProps {
  current: number;
  /** The furthest step visited; the list jumps to any step up to it. */
  reached: number;
  onJump: (step: number) => void;
  /** Whether the brain already has the key, so the key step reads Key set, not Required. */
  keySet: boolean;
}

export function SidePanel({ current, reached, onJump, keySet }: SidePanelProps) {
  return (
    <aside className="wt-side on-navy">
      <div className="wt-scout">
        <div className="wt-tile">
          <ScoutGlyph size={96} />
        </div>
        <p className="wt-name tg-wordmark">Scout</p>
        <p className="wt-role">Your companion</p>
      </div>
      <ol className="wt-steps" aria-label="Steps">
        {STEPS.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              disabled={step.id > reached}
              aria-current={step.id === current ? 'step' : undefined}
              data-done={step.id < current ? 'true' : undefined}
              onClick={() => onJump(step.id)}
            >
              <span className="wt-mark" aria-hidden="true">
                {step.id < current ? '✓' : ''}
              </span>
              {step.title}
              {!step.skippable && <span className="wt-req">{keySet ? 'Key set' : 'Required'}</span>}
            </button>
          </li>
        ))}
      </ol>
      <p className="wt-foot">You can change all of this later in Home, under Settings.</p>
    </aside>
  );
}
