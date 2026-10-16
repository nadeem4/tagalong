/** Tests for SightBar: what is attached, full view and the image token estimate. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import { SightBar, estimateImageTokens } from './sight-bar';

const snapshot: ContextSnapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  capturedAt: '2026-09-11T10:00:00.000Z',
  host: 'desktop',
  app: { name: 'Code.exe', windowTitle: 'README.md - ai_pet' },
  selection: 'x'.repeat(42),
};

const withScreenshot: ContextSnapshot = {
  ...snapshot,
  screenshot: { mime: 'image/png', base64: 'iVBORw0KGgo=', width: 1280, height: 800 },
};

function noop(): void {}

describe('SightBar', () => {
  it('names the selection, app and window that will be attached', () => {
    render(<SightBar snapshot={snapshot} problem={null} onLook={noop} onClear={noop} />);

    const bar = screen.getByTestId('sight-bar');
    expect(bar).toHaveAttribute('data-state', 'seeing');
    expect(bar).toHaveTextContent('Seeing');
    expect(bar).toHaveTextContent('42 chars');
    expect(bar).toHaveTextContent('Code.exe');
    expect(bar).toHaveTextContent('README.md - ai_pet');
  });

  it('names the page title when the browser host attached a page', () => {
    const page: ContextSnapshot = {
      id: '11111111-1111-4111-8111-111111111111',
      capturedAt: '2026-09-11T10:00:00.000Z',
      host: 'extension',
      app: { name: 'chrome', windowTitle: 'Release notes' },
      selection: 'the exact words',
      page: { url: 'https://example.com/notes', title: 'Release notes', text: 'x'.repeat(1200) },
    };
    render(<SightBar snapshot={page} problem={null} onLook={noop} onClear={noop} />);

    const bar = screen.getByTestId('sight-bar');
    expect(bar).toHaveAttribute('data-state', 'seeing');
    expect(bar).toHaveTextContent('15 chars');
    expect(bar).toHaveTextContent('page “Release notes”');
    // The tab title is the page title; saying it twice would crowd out everything else.
    expect(bar).not.toHaveTextContent('chrome — Release notes');
  });

  it('lets a host name its Look action for what it actually captures', () => {
    render(
      <SightBar
        snapshot={null}
        problem={null}
        onLook={noop}
        onClear={noop}
        lookLabel="Read this page"
      />,
    );

    expect(screen.getByRole('button', { name: 'Read this page' })).toBeInTheDocument();
  });

  it('shows a thumbnail of the attached screenshot', () => {
    render(<SightBar snapshot={withScreenshot} problem={null} onLook={noop} onClear={noop} />);

    expect(screen.getByTestId('sight-thumbnail')).toHaveAttribute(
      'src',
      'data:image/png;base64,iVBORw0KGgo=',
    );
  });

  it('offers a remove control that drops the attached context', () => {
    const onClear = vi.fn();
    render(<SightBar snapshot={withScreenshot} problem={null} onLook={noop} onClear={onClear} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('says plainly that it is not seeing anything when nothing is attached', () => {
    render(<SightBar snapshot={null} problem={null} onLook={noop} onClear={noop} />);

    const bar = screen.getByTestId('sight-bar');
    expect(bar).toHaveAttribute('data-state', 'blind');
    expect(bar).toHaveTextContent('Not seeing anything');
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('offers the Look action while it cannot see', () => {
    const onLook = vi.fn();
    render(<SightBar snapshot={null} problem={null} onLook={onLook} onClear={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Look at screen' }));

    expect(onLook).toHaveBeenCalledTimes(1);
  });

  it('says capture is blocked here rather than showing nothing', () => {
    render(<SightBar snapshot={null} problem="blocked" onLook={noop} onClear={noop} />);

    const bar = screen.getByTestId('sight-bar');
    expect(bar).toHaveAttribute('data-state', 'blocked');
    expect(bar).toHaveTextContent('Capture is blocked here');
    expect(screen.getByRole('button', { name: 'Look at screen' })).toBeInTheDocument();
  });

  it('says a capture failed instead of silently staying blind', () => {
    render(<SightBar snapshot={null} problem="failed" onLook={noop} onClear={noop} />);

    expect(screen.getByTestId('sight-bar')).toHaveTextContent('Capture did not work');
  });
});

const PNG = { mime: 'image/png', base64: 'iVBORw0KGgo=', width: 1568, height: 882 } as const;

function displayed(
  id: number,
  extra: { focused?: boolean; blocked?: { rule: 'processName'; entry: string } } = {},
) {
  return {
    id,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    primary: id === 101,
    focused: extra.focused ?? false,
    image: PNG,
    ...(extra.blocked === undefined ? {} : { blocked: extra.blocked }),
  };
}

const fullView: ContextSnapshot = {
  ...snapshot,
  composite: PNG,
  displays: [displayed(101, { focused: true }), displayed(102), displayed(103)],
};

describe('SightBar, full view', () => {
  it('says how many screens are going with the ask', () => {
    // The bar names what leaves the machine. Three monitors is three times as much of
    // the user's desk as they may realise they just shared.
    render(<SightBar snapshot={fullView} problem={null} onLook={noop} onClear={noop} />);

    expect(screen.getByTestId('sight-bar')).toHaveTextContent('3 screens');
  });

  it('lists the screens by the number drawn on the composite', () => {
    render(<SightBar snapshot={fullView} problem={null} onLook={noop} onClear={noop} />);

    const bar = screen.getByTestId('sight-bar');
    expect(bar).toHaveTextContent('1');
    expect(bar).toHaveTextContent('2');
    expect(bar).toHaveTextContent('3');
  });

  it('says when a screen was blanked rather than letting it look captured', () => {
    render(
      <SightBar
        snapshot={{
          ...fullView,
          displays: [
            displayed(101, { focused: true }),
            displayed(102, { blocked: { rule: 'processName', entry: '1Password.exe' } }),
          ],
        }}
        problem={null}
        onLook={noop}
        onClear={noop}
      />,
    );

    expect(screen.getByTestId('sight-bar')).toHaveTextContent('blocked');
  });

  it('shows the composite as the thumbnail when there is no single screenshot', () => {
    render(<SightBar snapshot={fullView} problem={null} onLook={noop} onClear={noop} />);

    expect(screen.getByTestId('sight-thumbnail')).toBeInTheDocument();
  });

  it('leaves a Phase 2 snapshot reading exactly as it did', () => {
    render(<SightBar snapshot={withScreenshot} problem={null} onLook={noop} onClear={noop} />);

    const bar = screen.getByTestId('sight-bar');
    expect(bar).toHaveTextContent('screen 1280×800');
    expect(bar).not.toHaveTextContent('screens');
  });
});

describe('SightBar image token estimate', () => {
  const image = (width: number, height: number) => ({
    mime: 'image/png' as const,
    base64: 'iVBORw0KGgo=',
    width,
    height,
  });

  it('estimates one image as width times height over 750', () => {
    render(
      <SightBar
        snapshot={{ ...snapshot, screenshot: image(1500, 750) }}
        problem={null}
        onLook={noop}
        onClear={noop}
      />,
    );
    // 1500 × 750 / 750 = 1500.
    expect(screen.getByTestId('image-tokens')).toHaveTextContent('~1,500 image tokens');
  });

  it('sums three images: the composite and two displays', () => {
    const display = (id: number, width: number, height: number) => ({
      id,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      primary: id === 1,
      focused: id === 1,
      image: image(width, height),
    });
    render(
      <SightBar
        snapshot={{
          ...snapshot,
          composite: image(1568, 441),
          displays: [display(1, 1568, 882), display(2, 750, 750)],
        }}
        problem={null}
        onLook={noop}
        onClear={noop}
      />,
    );
    // 1568×441/750 = 921.98, 1568×882/750 = 1843.97, 750×750/750 = 750: 3,516 rounded.
    expect(screen.getByTestId('image-tokens')).toHaveTextContent('~3,516 image tokens');
    expect(screen.getByTestId('image-tokens')).toHaveTextContent('3 images');
  });

  it('shows nothing when no image is attached', () => {
    render(<SightBar snapshot={snapshot} problem={null} onLook={noop} onClear={noop} />);
    expect(screen.queryByTestId('image-tokens')).toBeNull();
  });
});

describe('estimateImageTokens', () => {
  it('is width times height over 750, summed', () => {
    expect(estimateImageTokens([{ width: 750, height: 1 }])).toBe(1);
    expect(estimateImageTokens([])).toBe(0);
  });
});
