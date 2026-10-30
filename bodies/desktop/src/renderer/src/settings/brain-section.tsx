/**
 * Settings' How Scout thinks section: Scout's real brain with a status chip. When Claude Code
 * is not here or is signed out, it says so and offers Check again.
 */
import type { ScoutBrain } from './brain';
import { Section } from './section';

export function BrainSection({
  brain,
  onCheckAgain,
}: {
  brain: ScoutBrain;
  onCheckAgain: () => void;
}) {
  if (brain.state === 'engine-down') {
    return (
      <Section id="brain">
        <div className="tg-alert tg-alert--err" role="status">
          <p className="tg-alert__title">Scout&apos;s engine didn&apos;t start</p>
          <p>
            Settings can still be changed. Sign-in status and model lists come back once it&apos;s
            running.
          </p>
        </div>
      </Section>
    );
  }

  if (brain.state === 'no-sign-in') {
    return (
      <Section id="brain">
        <div className="tg-alert tg-alert--warn">
          <p className="tg-alert__title">Scout needs a brain to think with</p>
          <p>
            Claude Code isn&apos;t on this computer. Install it and sign in, and Scout uses that
            with no key.
          </p>
        </div>
        <div className="tg-actions">
          <button type="button" className="tg-btn-quiet" onClick={onCheckAgain}>
            I signed in to Claude Code, check again
          </button>
        </div>
      </Section>
    );
  }

  const canFix = brain.state === 'signed-out' || brain.state === 'unknown';
  return (
    <Section id="brain">
      <div className="tg-scout">
        <div className="tg-scout__text">
          <p className="tg-scout__title">{brain.title}</p>
          {brain.help !== '' && <p className="tg-help">{brain.help}</p>}
        </div>
        {brain.chip !== null && (
          <span
            className={
              brain.chip.tone === 'plain' ? 'tg-chip' : `tg-chip tg-chip--${brain.chip.tone}`
            }
          >
            {brain.chip.tone === 'ok' && <Mark path="M5 12.5l4.5 4.5L19 7.5" />}
            {brain.chip.tone === 'warn' && <Mark path="M12 7v6M12 17h.01" />}
            {brain.chip.text}
          </span>
        )}
      </div>
      {canFix && (
        <div className="tg-actions">
          <button type="button" className="tg-btn-quiet" onClick={onCheckAgain}>
            Check again
          </button>
        </div>
      )}
    </Section>
  );
}

/** A small stroked icon for a chip. The chip's words carry the meaning; this only echoes it. */
function Mark({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d={path} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
