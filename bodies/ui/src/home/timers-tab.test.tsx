/** Tests for TimersTab: a row per timer with its fire time, "every N min" and Cancel. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimersTab } from './timers-tab';

const base = {
  id: 't1',
  note: 'stretch',
  nextAt: '2026-11-10T20:00:00+00:00',
  repeatMinutes: null,
  pending: false,
};

describe('TimersTab', () => {
  it('says every N min for a repeating timer and nothing for a one-off', () => {
    render(
      <TimersTab
        timers={[
          { ...base, repeatMinutes: 30 },
          { ...base, id: 't2', note: 'call Priya' },
        ]}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByText('every 30 min')).toBeVisible();
    expect(screen.getAllByText(/every/)).toHaveLength(1);
  });

  it('cancels one timer by id', () => {
    const onCancel = vi.fn();
    render(<TimersTab timers={[base]} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel stretch' }));
    expect(onCancel).toHaveBeenCalledWith('t1');
  });

  it('says no timers when there are none', () => {
    render(<TimersTab timers={[]} onCancel={() => undefined} />);
    expect(screen.getByText('No timers.')).toBeVisible();
  });
});
