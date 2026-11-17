/**
 * Tests for WaitingTab: the news Scout has not told yet, each with where it came from and how
 * long it has waited, a mark on the ones Scout gave up on, and the mail loops panel below.
 * Runs on the fake host bridge.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import type { WaitingEvent } from '../shapes';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { WaitingTab } from './waiting-tab';

const row = (over: Partial<WaitingEvent> = {}): WaitingEvent => ({
  id: 'e1',
  ageS: 7200,
  gaveUp: false,
  gist: 'Fix the build finished',
  ...over,
});

function show(events: WaitingEvent[]) {
  render(
    <HostBridgeProvider bridge={createFakeHostBridge()}>
      <WaitingTab events={events} />
    </HostBridgeProvider>,
  );
}

describe('WaitingTab', () => {
  it('shows each waiting event as its gist and age, in plain words', () => {
    show([row(), row({ id: 'e2', ageS: 90, gist: 'Stretch' })]);
    const list = screen.getByRole('list', { name: 'Waiting news' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Fix the build finished');
    expect(rows[0]).not.toHaveTextContent('job_done');
    expect(rows[0]).not.toHaveTextContent('job:j1');
    expect(rows[1]).not.toHaveTextContent('timer');
    expect(rows[0]).toHaveTextContent('2 h');
    expect(rows[1]).toHaveTextContent('1 min');
    expect(within(list).queryByText('Scout could not finish')).toBeNull();
  });

  it('marks a gave-up event', () => {
    show([row({ gaveUp: true })]);
    expect(screen.getByText('Scout could not finish')).toBeVisible();
  });

  it('says nothing is waiting when the list is empty', () => {
    show([]);
    expect(screen.getByText('Nothing is waiting to be told.')).toBeVisible();
  });
});
