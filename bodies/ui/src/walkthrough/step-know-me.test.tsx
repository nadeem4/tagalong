/** Tests for StepKnowMe: starting a run never blocks Next, the result replaces the form, a refused start shows. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { KnowMeStatus } from '../shapes';
import { StepKnowMe } from './step-know-me';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';

const DONE: KnowMeStatus = {
  sources: [{ name: 'GitHub', state: 'done' }],
  done: true,
  portrait: 'You build things end to end.',
};
const AT = '2026-11-12T09:00:00.000Z';

describe('StepKnowMe', () => {
  it('says what Scout reads and offers the form', async () => {
    const bridge = createFakeHostBridge();
    render(
      <HostBridgeProvider bridge={bridge}>
        <StepKnowMe />
      </HostBridgeProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Let Scout get to know you' })).toBeInTheDocument();
    expect(
      screen.getByText('Scout reads only public pages and the file you pick.'),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Your GitHub username')).toBeInTheDocument();
  });

  it('starts nothing on its own, so skipping leaves nothing started', async () => {
    const bridge = createFakeHostBridge();
    render(
      <HostBridgeProvider bridge={bridge}>
        <StepKnowMe />
      </HostBridgeProvider>,
    );
    await screen.findByLabelText('Your GitHub username');
    expect(bridge.knowStarts).toHaveLength(0);
  });

  it('starts the run with the username and shows progress, with a note that the person can move on', async () => {
    const bridge = createFakeHostBridge();
    render(
      <HostBridgeProvider bridge={bridge}>
        <StepKnowMe />
      </HostBridgeProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Your GitHub username'), {
      target: { value: 'octocat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get to know me' }));
    await waitFor(() => expect(bridge.knowStarts).toEqual([{ github: 'octocat' }]));
    expect(await screen.findByRole('list', { name: 'Progress' })).toBeInTheDocument();
    expect(screen.getByText(/you can move on/i)).toBeInTheDocument();
  });

  it('shows the result view when the status says done, with profile facts only', async () => {
    const bridge = createFakeHostBridge({
      memories: [
        {
          id: 'f1',
          kind: 'fact',
          text: 'Writes TypeScript',
          createdAt: AT,
          tag: 'skills',
          source: 'github',
        },
        { id: 'c1', kind: 'fact', text: 'Likes tea', createdAt: AT, source: 'chat' },
      ],
      portrait: 'You build things end to end.',
    });
    render(
      <HostBridgeProvider bridge={bridge}>
        <StepKnowMe />
      </HostBridgeProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Your GitHub username'), {
      target: { value: 'octocat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get to know me' }));
    await waitFor(() => expect(bridge.knowStarts).toHaveLength(1));
    act(() => bridge.emitKnowStatus(DONE));
    expect(await screen.findByText('You build things end to end.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /based on\? \(1 fact\)/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your GitHub username')).not.toBeInTheDocument();
  });

  it('shows a refused start in plain words and keeps the form', async () => {
    const bridge = createFakeHostBridge({ knowStartError: 'That PDF is over 10 MB.' });
    render(
      <HostBridgeProvider bridge={bridge}>
        <StepKnowMe />
      </HostBridgeProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Your GitHub username'), {
      target: { value: 'octocat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get to know me' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That PDF is over 10 MB.');
    expect(screen.getByLabelText('Your GitHub username')).toBeInTheDocument();
  });
});
