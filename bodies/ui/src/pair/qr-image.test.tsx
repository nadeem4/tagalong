/** Tests for QrImage: the brain's terminal QR text becomes one dark square per dark module. */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QrImage } from './qr-image';

describe('QrImage', () => {
  it('draws a dark square for each dark module and reads full and half blocks as light', () => {
    // Row 0 is all light. Row 1 is light, dark over dark, then a half block: top light, bottom dark.
    const { container } = render(
      <QrImage text={'\u2588\u2588\u2588\n\u2588 \u2580\n'} label="Pairing QR" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-label', 'Pairing QR');
    const dark = [...container.querySelectorAll('rect[data-dark]')].map((r) => [
      r.getAttribute('x'),
      r.getAttribute('y'),
    ]);
    expect(dark).toEqual([
      ['1', '2'],
      ['1', '3'],
      ['2', '3'],
    ]);
  });
});
