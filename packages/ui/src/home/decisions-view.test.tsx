/** Tests for DecisionsView: episodes in words, silence included, and an episode opened. */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Episode } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { DecisionsView } from './decisions-view';

const AT = '2026-10-19T10:00:00.000Z';

const episode = (fields: Partial<Episode> & Pick<Episode, 'id' | 'mode' | 'trigger'>) =>
  ({ petId: 'scout', startedAt: AT, ...fields }) as Episode;

const QUIET = episode({
  id: 'e3',
  mode: 'check-in',
  trigger: 'trouble',
  decision: 'quiet',
  model: 'sonnet',
  input: 'Why you woke: npm test failed in the terminal.',
});
const SPOKE = episode({
  id: 'e2',
  mode: 'check-in',
  trigger: 'settled',
  decision: 'offered',
  said: 'That test failed again.',
  note: 'Fix the flaky test',
});
const ANSWERED = episode({
  id: 'e1',
  mode: 'turn',
  trigger: 'asked',
  decision: 'answered',
  model: 'sonnet',
  input: 'What does this error mean?',
  said: 'Port 3000 is taken.',
  inputTokens: 1200,
  outputTokens: 80,
});

async function renderDecisions(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <DecisionsView name="Scout" />
    </HostBridgeProvider>,
  );
  return screen.findByRole('list', { name: 'Decisions' });
}

describe('DecisionsView', () => {
  it('lists every decision in words, newest first, silence included', async () => {
    const list = await renderDecisions(
      createFakeHostBridge({ episodes: [QUIET, SPOKE, ANSWERED] }),
    );
    const lines = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(lines[0]).toContain('Scout stayed quiet');
    expect(lines[0]).toContain('An error on screen');
    expect(lines[1]).toContain('Scout offered to help');
    expect(lines[1]).toContain('That test failed again.');
    expect(lines[2]).toContain('Scout answered');
    expect(lines[2]).toContain('You asked');
    expect(lines[2]).toContain('1,280 tokens');
  });

  it('opens an episode: what it was shown, each tool it used, what it said, what you did', async () => {
    const bridge = createFakeHostBridge({
      episodes: [SPOKE, ANSWERED],
      episodeEvents: {
        e1: [
          {
            kind: 'step',
            name: 'read_window_text',
            input: '{"id":7}',
            result: 'EADDRINUSE :3000',
            ok: true,
            at: AT,
          },
          { kind: 'step', name: 'look_closer', ok: false, result: 'Blind spot', at: AT },
        ],
        e2: [{ kind: 'outcome', name: 'not-now', at: AT }],
      },
    });
    await renderDecisions(bridge);

    fireEvent.click(screen.getByRole('button', { name: /Scout answered/ }));
    const turn = await screen.findByRole('region', { name: /Scout answered/ });
    await waitFor(() => expect(turn).toHaveTextContent('read_window_text'));
    expect(turn).toHaveTextContent('What it was shown');
    expect(turn).toHaveTextContent('What does this error mean?');
    expect(turn).toHaveTextContent('EADDRINUSE :3000');
    expect(turn).toHaveTextContent('look_closer');
    expect(turn).toHaveTextContent('failed: Blind spot');
    expect(turn).toHaveTextContent('Port 3000 is taken.');

    fireEvent.click(screen.getByRole('button', { name: /Scout offered to help/ }));
    const offer = await screen.findByRole('region', { name: /Scout offered to help/ });
    await waitFor(() => expect(offer).toHaveTextContent('You said Not now'));
    expect(offer).toHaveTextContent('Fix the flaky test');
  });

  it('says what the page is for before anything is recorded', async () => {
    render(
      <HostBridgeProvider bridge={createFakeHostBridge({ episodes: [] })}>
        <DecisionsView name="Scout" />
      </HostBridgeProvider>,
    );
    expect(await screen.findByText(/Every time Scout decides something/)).toBeInTheDocument();
  });

  it('pages older episodes', async () => {
    const many = Array.from({ length: 31 }, (_, i) =>
      episode({ id: `e${i}`, mode: 'check-in', trigger: 'back', decision: 'quiet' }),
    );
    const list = await renderDecisions(createFakeHostBridge({ episodes: many }));
    expect(within(list).getAllByRole('button')).toHaveLength(30);
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(31));
  });
});
