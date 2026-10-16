/**
 * Settings' Advanced section: the tuning knobs, closed by default behind a real disclosure
 * button. Closed only hides it: every field stays in the form, so saving never drops a value
 * nobody opened.
 */
import type { ReactNode } from 'react';

export function AdvancedSection({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section id="advanced" className="tg-panel" aria-labelledby="advanced-heading">
      <h2 className="tg-disclosure__heading">
        <button
          type="button"
          className="tg-disclosure"
          aria-expanded={open}
          aria-controls="advanced-body"
          onClick={onToggle}
        >
          <span className="tg-disclosure__text">
            <span id="advanced-heading" className="tg-px tg-panel__heading">
              Advanced
            </span>
            <span className="tg-help">
              Tuning knobs. The defaults are fine for almost everyone.
            </span>
          </span>
          <span className="tg-disclosure__state">{open ? 'Hide' : 'Show'}</span>
          <svg
            aria-hidden="true"
            className="tg-disclosure__chevron"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </h2>
      <div id="advanced-body" className="tg-advanced" hidden={!open}>
        {children}
        <div className="tg-actions">
          <button
            type="button"
            className="tg-btn-quiet"
            onClick={() => void window.tagalongHost.openOnboarding()}
          >
            Open Welcome again
          </button>
        </div>
      </div>
    </section>
  );
}
