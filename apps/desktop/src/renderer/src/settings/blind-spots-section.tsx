import { BLIND_SPOTS } from '@tagalong/protocol';
import { blindSpotExamples } from '../settings-form';
import { Section } from './section';

/**
 * The built-in blind spots, read-only. They are always on: nothing here can switch them
 * off, so clearing your own exclusion list never takes them away.
 */
export function BlindSpotsSection() {
  return (
    <Section id="blindSpots">
      <p className="tg-note">
        Built in and always on. Scout takes no screenshot of these windows, reads none of their text
        and copies nothing you highlight there.
      </p>
      <ul>
        {BLIND_SPOTS.map((spot) => (
          <li key={spot.label}>
            <strong>{spot.label}.</strong> {spot.reason}
            <br />
            <span className="tg-note">{blindSpotExamples(spot)}</span>
          </li>
        ))}
      </ul>
      <p className="tg-note">
        Anything that still looks like a key, a token, a password or a card number is hidden before
        it leaves this computer, and Scout&apos;s experts may not open secret files either.
      </p>
    </Section>
  );
}
