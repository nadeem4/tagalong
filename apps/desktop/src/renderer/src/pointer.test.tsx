import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PointerRingView } from './pointer';

const RING = { rect: { x: 100, y: 200, width: 80, height: 30 }, label: 'Export' };
const CSS = readFileSync(new URL('./pointer.css', import.meta.url), 'utf8');

describe('PointerRingView', () => {
  it('draws a ring around the rect with its label', () => {
    const html = renderToStaticMarkup(<PointerRingView ring={RING} reducedMotion={false} />);
    expect(html).toContain('Export');
    expect(html).toMatch(/left:\s*\d+px/);
    expect(html).toContain('class="pointer-ring"');
  });

  it('marks the ring still under reduced motion, and the sheet drops its animation', () => {
    const html = renderToStaticMarkup(<PointerRingView ring={RING} reducedMotion />);
    expect(html).toContain('pointer-ring still');
    expect(CSS).toMatch(/\.pointer-ring\.still\s*\{[^}]*animation:\s*none/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
  });

  it('leaves the label out when there is none', () => {
    const html = renderToStaticMarkup(
      <PointerRingView ring={{ ...RING, label: '' }} reducedMotion={false} />,
    );
    expect(html).not.toContain('pointer-label');
  });
});
