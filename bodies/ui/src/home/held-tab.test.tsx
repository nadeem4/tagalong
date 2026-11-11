/**
 * Tests for HeldTab: besides the held loops, it lists every open item (a card still waiting for
 * a yes) with a plain line and how long it has waited. Runs on the fake host bridge.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { HeldTab } from './held-tab';

function open(openItems: { id: string; kind: string; title: string; ageS: number }[]) {
  const bridge = createFakeHostBridge({ loops: { apps: [], loops: [], openItems } });
  render(
    <HostBridgeProvider bridge={bridge}>
      <HeldTab />
    </HostBridgeProvider>,
  );
}

describe('HeldTab', () => {
  it('lists open items with what they are and how long they have waited', async () => {
    open([
      { id: 'a1', kind: 'ask', title: "I'll delete 3 old logs.", ageS: 7200 },
      { id: 'o1', kind: 'offer', title: 'offer', ageS: 90 },
    ]);
    const list = await screen.findByRole('list', { name: 'Waiting on you' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("I'll delete 3 old logs.");
    expect(rows[0]).toHaveTextContent('2 h');
    expect(rows[1]).toHaveTextContent('1 min');
  });

  it('says nothing is waiting when there are no open items', async () => {
    open([]);
    expect(await screen.findByText('Nothing is waiting on you.')).toBeInTheDocument();
  });
});
