/**
 * The walkthrough's navy side: Scout's still mark, the "Scout" wordmark, the steps (only
 * those already reached can be jumped to) and the footnote. Contains SidePanel.
 */

import { ScoutGlyph } from '../scout-mark';
import { STEPS, type StepInfo } from './steps';

interface SidePanelProps {
  current: number;
  /** The furthest step visited; the list jumps to any step up to it. */
  reached: number;
  onJump: (step: number) => void;
  /** Whether the brain already has the key, so the key step reads Key set, not Required. */
  keySet: boolean;
  /** The other computer the brain runs on, if this one is paired to one; its steps read "On <name>". */
  brainName?: string | null;
}

function badge(step: StepInfo, keySet: boolean, brainName: string | null): string | null {
  if (brainName !== null && step.onBrain) return `On ${brainName}`;
  if (step.skippable) return null;
  return keySet ? 'Key set' : 'Required';
}

export function SidePanel({ current, reached, onJump, keySet, brainName = null }: SidePanelProps) {
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
        {STEPS.map((step) => {
          const tag = badge(step, keySet, brainName);
          return (
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
                {tag !== null && <span className="wt-req">{tag}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="wt-foot">You can change all of this later in Home, under Settings.</p>
    </aside>
  );
}
