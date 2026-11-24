/**
 * The brain's pairing QR, drawn as an image. The brain sends it as terminal text (a full block
 * is light, a space dark, a half block one of each), so this reads those back into squares.
 * Contains QrImage.
 */

import { useMemo } from 'react';

const DARK_TOP = new Set([' ', '\u2584']);
const DARK_BOTTOM = new Set([' ', '\u2580']);

export function QrImage({ text, label }: { text: string; label: string }) {
  const { path, width, height } = useMemo(() => {
    const lines = text.split('\n').filter((line) => line !== '');
    let squares = '';
    lines.forEach((line, row) => {
      [...line].forEach((ch, x) => {
        if (DARK_TOP.has(ch)) squares += `M${x} ${row * 2}h1v1h-1z`;
        if (DARK_BOTTOM.has(ch)) squares += `M${x} ${row * 2 + 1}h1v1h-1z`;
      });
    });
    return {
      path: squares,
      width: Math.max(0, ...lines.map((line) => [...line].length)),
      height: lines.length * 2,
    };
  }, [text]);
  return (
    <svg
      className="pair-qr"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect className="pair-qr__light" width={width} height={height} />
      <path data-dark="" d={path} />
    </svg>
  );
}
