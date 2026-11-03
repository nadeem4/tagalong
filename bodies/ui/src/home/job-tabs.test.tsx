/**
 * Tests for JobTabs: tablist semantics (selected tab, roving tabindex) and the keyboard moves.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { JobTabs } from './job-tabs';

const TABS = [
  { id: 'a', label: 'Overview' },
  { id: 'b', label: 'Activity' },
  { id: 'c', label: 'Reports' },
];

function Harness() {
  const [selected, setSelected] = useState('a');
  return <JobTabs tabs={TABS} selected={selected} onSelect={setSelected} />;
}

describe('JobTabs', () => {
  it('marks one tab selected and only that tab tabbable', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Job sections' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('arrow keys move between tabs, wrapping, and Home and End jump', () => {
    render(<Harness />);
    const [first, second, third] = screen.getAllByRole('tab') as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'End' });
    expect(third).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(third, { key: 'ArrowRight' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(third).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(third, { key: 'Home' });
    expect(first).toHaveAttribute('aria-selected', 'true');
  });

  it('a click selects the tab', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }));
    expect(screen.getByRole('tab', { name: 'Reports' })).toHaveAttribute('aria-selected', 'true');
  });
});
