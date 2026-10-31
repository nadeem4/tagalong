/** Tests for HomeView: the nav and the pages the Python brain feeds. */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Pet } from '../shapes';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { HomeView, type HomeHost, type HomePage } from './home-view';

/** A fake idle strip: the host passes Bean's real one. */
const IDLE = { src: 'idle.webp', frames: 36, fps: 12, loop: true };

const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🦊',
};

function host(): HomeHost {
  return {};
}

function renderHome(
  bridge: FakeHostBridge,
  props: { page?: HomePage; homeHost?: HomeHost; onPage?: (page: HomePage) => void } = {},
) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <HomeView
        host={props.homeHost ?? host()}
        scout={IDLE}
        settings={<p>The settings form</p>}
        {...(props.page === undefined ? {} : { page: props.page })}
        {...(props.onPage === undefined ? {} : { onPage: props.onPage })}
      />
    </HostBridgeProvider>,
  );
}

describe('HomeView', () => {
  it('is one window: Scout and the pages the brain feeds', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    expect(within(nav).getByText('Your companion')).toBeVisible();
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Overview', 'Jobs', 'Connections', 'Approvals', 'What Scout remembers', 'Settings']);
  });

  it('home nav has an Approvals item that opens the page', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approvals' }));
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeVisible();
  });

  it('draws Scout in the nav tile as Bean, a still idle frame cropped to fill it', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    const tile = nav.querySelector('.home-nav__tile') as HTMLElement;
    await waitFor(() => expect(within(tile).getByTestId('bean-clip')).toBeInTheDocument());
    const clip = within(tile).getAllByTestId('bean-clip');
    expect(clip).toHaveLength(1);
    expect(clip[0]).toHaveAttribute('data-clip', 'idle');
    expect(clip[0]!.style.backgroundImage).toBe('url("idle.webp")');
    // Drawn larger than the 56 px tile, which crops it: Bean fills about two thirds of a frame.
    expect(clip[0]!.style.width).toBe('76px');
    expect(clip[0]!.style.animation).toBe('');
  });

  it('leaves the nav tile empty until the companion loads', () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const tile = document.querySelector('.home-nav__tile') as HTMLElement;
    expect(within(tile).queryByTestId('bean-clip')).toBeNull();
  });

  it('shows What Scout remembers, each memory deletable', async () => {
    const bridge = createFakeHostBridge({
      pets: [SCOUT],
      memories: [
        {
          id: 'm1',
          kind: 'preference',
          text: 'Short answers',
          createdAt: '2026-10-16T09:00:00.000Z',
        },
      ],
    });
    renderHome(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'What Scout remembers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete: Short answers' }));
    expect(await screen.findByText('Scout doesn’t remember anything yet.')).toBeVisible();
    expect(bridge.memories).toEqual([]);
  });

  it('opens on an overview that says nothing about which brain thinks', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const scout = await screen.findByRole('region', { name: 'Scout' });
    expect(scout).toHaveTextContent('Never at its blind spots.');
    expect(scout).not.toHaveTextContent('Thinks with');
    expect(screen.queryByRole('region', { name: 'Experts' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull();
  });

  it('shows where things run on the overview', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const where = await screen.findByRole('region', { name: 'Where things run' });
    await waitFor(() => expect(where).toHaveTextContent('ws://127.0.0.1:47321'));
  });

  it('says what is really wrong with Scout instead of plain Ready', async () => {
    const paused: HomeHost = {
      status: () => Promise.resolve({ text: 'Ready, sight paused', ok: false }),
    };
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), { homeHost: paused });
    const scout = await screen.findByRole('region', { name: 'Scout' });
    await waitFor(() => expect(scout).toHaveTextContent('Ready, sight paused'));
  });

  it('moves between pages, and reports the page to the host', async () => {
    const pages: HomePage[] = [];
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), {
      onPage: (page) => pages.push(page),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Connections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('The settings form')).toBeVisible();
    expect(pages).toEqual(['connections', 'settings']);
  });

  it('shows Jobs on its own page only', async () => {
    const jobs = [
      {
        id: 'j1',
        agent: 'claude-code',
        task: 'Fix the login bug',
        folder: 'C:\\code\\app',
        mode: 'edit',
        state: 'running',
        reason: null,
        progress: null,
        result: null,
        startedAt: '2026-10-28T09:00:00.000Z',
        endedAt: null,
      },
    ];
    renderHome(createFakeHostBridge({ pets: [SCOUT], jobs }), { page: 'jobs' });
    const panel = await screen.findByRole('region', { name: 'Jobs' });
    expect(within(panel).getByText('Fix the login bug')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.queryByRole('region', { name: 'Jobs' })).toBeNull();
  });

  it('has no pages for features that are not built', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    for (const gone of [
      /Waiting on you/,
      /^Scout$/,
      /Experts/,
      /Routines/,
      /Activity/,
      /decided/,
      /What Scout saw/,
      /learned/,
    ]) {
      expect(within(nav).queryByRole('button', { name: gone })).toBeNull();
    }
  });

  it('opens on the page the host asks for', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), { page: 'settings' });
    expect(await screen.findByText('The settings form')).toBeVisible();
  });

  it('shows Permissions under the settings form on the Settings page only', async () => {
    const permissions = [
      {
        name: 'recall',
        description: 'Look up what Scout remembers',
        effect: 'read' as const,
        mode: 'auto' as const,
        locked: false,
        online: true,
      },
    ];
    renderHome(createFakeHostBridge({ pets: [SCOUT], permissions }), { page: 'settings' });
    expect(await screen.findByText('The settings form')).toBeVisible();
    expect(await screen.findByRole('switch', { name: 'recall' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.queryByRole('switch', { name: 'recall' })).toBeNull();
  });
});
