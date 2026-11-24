/** Tests for QrImage: the brain's terminal QR text becomes one dark path with a square per dark module. */

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
    expect(container.querySelectorAll('rect')).toHaveLength(1);
    expect(container.querySelector('path[data-dark]')).toHaveAttribute(
      'd',
      'M1 2h1v1h-1zM1 3h1v1h-1zM2 3h1v1h-1z',
    );
  });
});
