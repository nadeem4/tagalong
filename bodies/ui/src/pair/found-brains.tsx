/**
 * Brains announcing themselves on the home network, each with a Pair button that starts pairing
 * with that one. Nothing found leaves it out. Contains FoundBrains.
 */

import { Button } from '../controls';
import type { FoundBrain } from '../shapes/pairing';

export function FoundBrains({
  brains,
  onPick,
}: {
  brains: readonly FoundBrain[];
  onPick: (brain: FoundBrain) => void;
}) {
  if (brains.length === 0) return null;
  return (
    <div className="pair-found">
      <span className="pair-label">Found nearby</span>
      <ul className="tg-card pair-foundlist">
        {brains.map((brain) => (
          <li key={brain.addr}>
            <div>
              <strong>{brain.name}</strong>
              <span className="pair-meta">{brain.addr}</span>
            </div>
            <Button
              variant="secondary"
              aria-label={`Pair with ${brain.name}`}
              onClick={() => onPick(brain)}
            >
              Pair
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
