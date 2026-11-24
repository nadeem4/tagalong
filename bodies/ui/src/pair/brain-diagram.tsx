/**
 * A small drawing of where the brain lives for one path of the brain step: this PC alone, or
 * this PC beside another PC or a server. The gold dot marks the machine the brain runs on.
 * Contains BrainDiagram.
 */

function Machine({
  kind,
  x,
  y,
  brain,
}: {
  kind: 'pc' | 'server';
  x: number;
  y: number;
  brain: boolean;
}) {
  return (
    <>
      <g transform={`translate(${x},${y})`}>
        {kind === 'server' ? (
          <>
            <rect x="0" y="0" width="34" height="12" rx="3" />
            <rect x="0" y="16" width="34" height="12" rx="3" />
            <path d="M6 6h.01M6 22h.01" />
          </>
        ) : (
          <>
            <rect x="0" y="0" width="34" height="23" rx="3" />
            <path d="M11 28h12M17 23v5" />
          </>
        )}
      </g>
      {brain && (
        <circle
          className="pair-diag__brain"
          cx={x + 17}
          cy={y + (kind === 'server' ? 6 : 11.5)}
          r="5"
        />
      )}
    </>
  );
}

export function BrainDiagram({ place }: { place: 'this' | 'other' | 'server' }) {
  return (
    <svg className="pair-diag" viewBox="0 0 132 56" aria-hidden="true">
      {place === 'this' ? (
        <Machine kind="pc" x={49} y={10} brain />
      ) : (
        <>
          <Machine kind="pc" x={4} y={10} brain={false} />
          <path d="M46 25h40" strokeDasharray="3 4" />
          <Machine
            kind={place === 'server' ? 'server' : 'pc'}
            x={94}
            y={place === 'server' ? 12 : 10}
            brain
          />
        </>
      )}
    </svg>
  );
}
