/**
 * The brain's pairing QR, drawn as an image. The brain sends it as terminal text (a full block
 * is light, a space dark, a half block one of each), so this reads those back into squares.
 * Contains QrImage.
 */

const DARK_TOP = new Set([' ', '\u2584']);
const DARK_BOTTOM = new Set([' ', '\u2580']);

export function QrImage({ text, label }: { text: string; label: string }) {
  const lines = text.split('\n').filter((line) => line !== '');
  const width = Math.max(0, ...lines.map((line) => [...line].length));
  const squares: { x: number; y: number }[] = [];
  lines.forEach((line, row) => {
    [...line].forEach((ch, x) => {
      if (DARK_TOP.has(ch)) squares.push({ x, y: row * 2 });
      if (DARK_BOTTOM.has(ch)) squares.push({ x, y: row * 2 + 1 });
    });
  });
  return (
    <svg
      className="pair-qr"
      viewBox={`0 0 ${width} ${lines.length * 2}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect className="pair-qr__light" width={width} height={lines.length * 2} />
      {squares.map(({ x, y }) => (
        <rect key={`${x}-${y}`} data-dark="" x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  );
}
