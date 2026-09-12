import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import { SightBar } from './sight-bar';

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
