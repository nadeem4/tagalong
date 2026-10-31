/**
 * The walkthrough's navy side: Bean standing still, "Your companion", the nine steps (only
 * those already reached can be jumped to) and the footnote. Contains SidePanel.
 */

import { BeanClip } from '../theme/bean-clip';
import type { BeanClipData } from '../theme/bean-clip';
import { STEPS } from './steps';

interface SidePanelProps {
  scout: BeanClipData;
  current: number;
  /** The furthest step visited; the list jumps to any step up to it. */
  reached: number;
  onJump: (step: number) => void;
}

export function SidePanel({ scout, current, reached, onJump }: SidePanelProps) {
  return (
    <aside className="wt-side">
      <div className="wt-scout">
        <div className="wt-tile">
          <BeanClip clip={scout} still size={132} name="idle" />
        </div>
        <p className="wt-name">Scout</p>
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
              {!step.skippable && <span className="wt-req">Required</span>}
            </button>
          </li>
        ))}
      </ol>
      <p className="wt-foot">You can change all of this later in Home, under Settings.</p>
    </aside>
  );
}
