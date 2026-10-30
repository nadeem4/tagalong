/** Tests for HealthCard: rows, Fix it and Set up. */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HealthCard } from './health-card';
import type { HealthRow } from './health';

const ROWS: HealthRow[] = [
  { id: 'brain', label: 'Brain', state: 'ok', line: 'Ready.' },
  {
    id: 'voice',
    label: 'Voice',
    state: 'broken',
    line: 'The ElevenLabs voice has no key.',
    fix: 'voice',
  },
  {
    id: 'microphone',
    label: 'Microphone',
    state: 'info',
    line: 'Not set up (optional)',
    fix: 'voice',
  },
];

describe('HealthCard', () => {
  it('starts with the headline, then one row per check with its line', () => {
    render(<HealthCard rows={ROWS} onFix={() => undefined} />);
    const card = screen.getByRole('region', { name: 'Health check' });
    expect(card).toHaveTextContent('One thing needs you.');
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Brain');
    expect(items[0]).toHaveTextContent('Ready.');
    expect(items[1]).toHaveTextContent('The ElevenLabs voice has no key.');
  });

  it('offers Fix it only on a broken row, and it opens that fix', () => {
    const onFix = vi.fn();
    render(<HealthCard rows={ROWS} onFix={onFix} />);
    const buttons = screen.getAllByRole('button', { name: /Fix/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onFix).toHaveBeenCalledWith('voice');
  });

  it('lets an optional row be set up, without calling it a problem', () => {
    const onFix = vi.fn();
    render(<HealthCard rows={ROWS} onFix={onFix} />);
    const setUp = screen.getByRole('button', { name: 'Set up Microphone' });
    expect(setUp).toHaveTextContent(/^Set up$/);
    expect(screen.getByRole('button', { name: 'Fix Voice' })).toHaveTextContent(/^Fix it$/);
    fireEvent.click(setUp);
    expect(onFix).toHaveBeenCalledWith('voice');
  });

  it('says it is checking while the facts are read', () => {
    render(<HealthCard rows={null} onFix={() => undefined} />);
    expect(screen.getByRole('region', { name: 'Health check' })).toHaveTextContent('Checking…');
  });

  it('never shows Fix it when the host cannot open one', () => {
    render(<HealthCard rows={ROWS} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers Open logs folder when the host can open it', () => {
    const onOpenLogs = vi.fn();
    render(<HealthCard rows={ROWS} onOpenLogs={onOpenLogs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open logs folder' }));
    expect(onOpenLogs).toHaveBeenCalledOnce();
  });

  it('has no Open logs folder while checking, or when the host cannot open it', () => {
    const { rerender } = render(<HealthCard rows={null} onOpenLogs={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Open logs folder' })).toBeNull();
    rerender(<HealthCard rows={ROWS} />);
    expect(screen.queryByRole('button', { name: 'Open logs folder' })).toBeNull();
  });
});
