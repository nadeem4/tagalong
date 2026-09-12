import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import { ContextChip } from './context-chip';

const snapshot: ContextSnapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  capturedAt: '2026-09-11T10:00:00.000Z',
  host: 'desktop',
  app: { name: 'Code.exe', windowTitle: 'README.md - ai_pet' },
  selection: 'x'.repeat(42),
};

describe('ContextChip', () => {
  it('shows the selection length, app name and window title that will be attached', () => {
    render(<ContextChip snapshot={snapshot} />);

    const chip = screen.getByTestId('context-chip');
    expect(chip).toHaveTextContent('42 chars selected');
    expect(chip).toHaveTextContent('Code.exe');
    expect(chip).toHaveTextContent('README.md - ai_pet');
  });

  it('renders nothing when there is no snapshot to attach', () => {
    render(<ContextChip snapshot={null} />);

    expect(screen.queryByTestId('context-chip')).not.toBeInTheDocument();
  });

  it('omits parts the host could not capture', () => {
    const { app: _app, selection: _selection, ...bare } = snapshot;
    render(<ContextChip snapshot={{ ...bare, app: { name: 'chrome.exe' } }} />);

    const chip = screen.getByTestId('context-chip');
    expect(chip).toHaveTextContent('chrome.exe');
    expect(chip).not.toHaveTextContent('chars selected');
  });
});
