/**
 * Scout's watch list for a job, read-only in the job page header: what Scout said it expects,
 * each item ticked or not. The text is data, so it is only ever rendered as text. Contains
 * WatchList.
 */
import { useId } from 'react';
import type { WatchItem } from '../host-bridge';

export function WatchList({ items }: { items: WatchItem[] | null }) {
  const captionId = useId();
  if (items === null || items.length === 0) return null;
  return (
    <div className="watch-list">
      <p id={captionId} className="watch-list__caption">
        Scout is checking
      </p>
      <ul className="watch-list__items" aria-labelledby={captionId}>
        {items.map((item, index) => (
          <li key={index} className="watch-list__item">
            <span
              role="img"
              aria-label={item.done ? 'done' : 'not done'}
              className={`watch-list__glyph${item.done ? ' watch-list__glyph--done' : ''}`}
            >
              {item.done ? '✓' : '○'}
            </span>
            <span className="watch-list__text">{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
