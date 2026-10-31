/**
 * The card after Finish: where Scout is and the keys to use it. Finish already marked the tour
 * seen; Close and Open Home only close the window. Contains FinishCard. Words are the spec's last card.
 */

interface FinishCardProps {
  /** The ask key as a person reads it, e.g. Ctrl+Shift+Space. */
  askKey: string;
  talkKey: string;
  onOpenHome: () => void;
  onClose: () => void;
  /** Why closing failed, if it did. */
  error?: string;
}

export function FinishCard({ askKey, talkKey, onOpenHome, onClose, error }: FinishCardProps) {
  return (
    <>
      <div className="wt-body">
        <section>
          <h1>Scout is on your screen</h1>
          <p className="wt-lead">
            Look for Scout at the bottom right. Press <span className="wt-kbd">{askKey}</span> to
            ask, or hold <span className="wt-kbd">{talkKey}</span> to talk.
          </p>
          <p className="wt-note">
            Connected apps, timers and what Scout remembers are in Home whenever you want them.
          </p>
        </section>
      </div>
      <footer className="wt-footer">
        {error ? (
          <p className="wt-error" role="alert">
            {error}
          </p>
        ) : null}
        <span className="wt-spacer" />
        <button type="button" className="wt-quiet" onClick={onOpenHome}>
          Open Home
        </button>
        <button type="button" className="wt-primary" onClick={onClose}>
          Close
        </button>
      </footer>
    </>
  );
}
