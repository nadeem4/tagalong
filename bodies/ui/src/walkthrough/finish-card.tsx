/**
 * The card after Finish: where Scout is and the keys to use it. Close (or Open Home) is what
 * marks the tour seen, in the shell. Contains FinishCard. Words are the spec's last card.
 */

interface FinishCardProps {
  /** The ask key as a person reads it, e.g. Ctrl+Shift+Space. */
  askKey: string;
  talkKey: string;
  onOpenHome: () => void;
  onClose: () => void;
}

export function FinishCard({ askKey, talkKey, onOpenHome, onClose }: FinishCardProps) {
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
