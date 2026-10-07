import type { OfficeStatus } from './status';
import { officeTokens as t } from './tokens';

const WORDS: Record<OfficeStatus, string> = { working: 'Working', desk: 'At desk' };

/** A status as an icon and a word, never colour alone. */
export function StatusLine({ status }: { status: OfficeStatus }) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: t.space.sm,
        fontSize: t.fontSize.small,
        color: t.color.textMuted,
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        {status === 'working' ? (
          <>
            <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
            <path d="M4.5 6.5h1M7.5 6.5h1M10.5 6.5h1M5 9.5h6" />
          </>
        ) : (
          <path d="M5 2v7h7M5 9v5M12 9v5M5 6h5" />
        )}
      </svg>
      {WORDS[status]}
    </span>
  );
}
