/**
 * The check card shown before a community app or expert is added: the facts (who made it, where
 * it runs, what nobody has checked) and Back or Add anyway. Focus moves to its heading when it
 * opens and returns to the button that opened it on Back. Contains CheckCard.
 */
import { useEffect, useRef, type RefObject } from 'react';
import type { AppRow } from '../shapes';
import { Button } from '../controls/button';
import { CheckFacts, type ExpertFacts } from '../setup/check-facts';
import { Icon } from '../setup/icons';

export function CheckCard({
  row,
  busy,
  onAddAnyway,
  onBack,
  returnFocus,
}: {
  row: AppRow | ExpertFacts;
  busy: boolean;
  onAddAnyway: () => void;
  onBack: () => void;
  /** The Add… button that opened the card; Back puts focus there again. */
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="cx-check" role="group" aria-label="Check first">
      <h4 className="cx-check__title" tabIndex={-1} ref={heading}>
        <Icon name="caution" />
        Check first
      </h4>
      <CheckFacts row={row} />
      <div className="cx-check__foot">
        <p>Scout still asks before it changes anything with it.</p>
        <Button
          variant="secondary"
          onClick={() => {
            onBack();
            returnFocus?.current?.focus();
          }}
        >
          Back
        </Button>
        <Button variant="primary" disabled={busy} onClick={onAddAnyway}>
          Add anyway
        </Button>
      </div>
    </div>
  );
}
