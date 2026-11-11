/** Tests for HomeView: the nav and the pages the Python brain feeds. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    ).toEqual([
      'Overview',
      'TasksNew',
      'Connections',
      'Approvals',
      'What Scout remembers',
      'Settings',
    ]);
  });

  it('nav says Tasks with a New badge and has no Jobs item', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    const tasks = within(nav).getByRole('button', { name: 'Tasks' });
    expect(tasks.querySelector('.home-nav__badge')).toHaveTextContent('New');
    expect(within(nav).queryByRole('button', { name: 'Jobs' })).toBeNull();
  });

  it('every page renders inside one .home-page wrapper', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    await screen.findByRole('navigation', { name: 'Tagalong' });
    for (const label of ['Overview', 'Tasks', 'Connections', 'Approvals', 'What Scout remembers']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      const main = document.querySelector('.home-main') as HTMLElement;
      expect(main.children).toHaveLength(1);
      expect(main.firstElementChild).toHaveClass('home-page');
    }
  });

  it('the nav marks the open page with aria-current and sits on navy', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    expect(nav).toHaveClass('on-navy');
    expect(within(nav).getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(within(nav).getByRole('button', { name: 'Tasks' }));
    expect(within(nav).getByRole('button', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('button', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('frames Overview as everything Scout is doing for you', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    expect(await screen.findByText('Everything Scout is doing for you.')).toBeVisible();
  });

  it('Show the tour again opens the walkthrough at step 1', async () => {
    const bridge = createFakeHostBridge({ pets: [SCOUT] });
    renderHome(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Show the tour again' }));
    expect(bridge.walkthroughOpens).toEqual([1]);
  });

  it('Show the tour again is a secondary button, not a bare quiet one', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const button = await screen.findByRole('button', { name: 'Show the tour again' });
    expect(button).toHaveClass('tg-button', 'tg-button--secondary');
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
    expect(screen.queryByRole('region', { name: 'For long jobs' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull();
  });

  it("shows where things run and Scout's brain on the overview", async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    await screen.findByRole('region', { name: 'Where things run' });
    const brain = await screen.findByRole('region', { name: "Scout's brain" });
    await waitFor(() => expect(brain).toHaveTextContent('127.0.0.1:47321'));
  });

  it('puts the update banner on the other pages, not twice on the overview', async () => {
    const stale = { ...(await createFakeHostBridge().brainCard()), update: 'ready' as const };
    renderHome(createFakeHostBridge({ pets: [SCOUT], brainCard: stale }));
    // On the overview the brain card carries the prompt: one, not two.
    await screen.findByRole('region', { name: "Scout's brain" });
    expect(await screen.findAllByText('Update ready')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(await screen.findAllByText('Update ready')).toHaveLength(1);
  });

  it('says what is really wrong with Scout instead of plain Ready', async () => {
    const paused: HomeHost = {
      status: () => Promise.resolve({ text: 'Ready, sight paused', ok: false }),
    };
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), { homeHost: paused });
    const scout = await screen.findByRole('region', { name: 'Scout' });
    await waitFor(() => expect(scout).toHaveTextContent('Ready, sight paused'));
  });

  it('says the brain is offline on the Scout card, and Ready again when it returns', async () => {
    let status: 'offline' | 'online' | 'outdated' = 'offline';
    const bridge = Object.assign(createFakeHostBridge({ pets: [SCOUT] }), {
      brainLink: () => Promise.resolve({ addr: 'ws://127.0.0.1:47321', status }),
    });
    renderHome(bridge);
    const scout = await screen.findByRole('region', { name: 'Scout' });
    await waitFor(() => expect(scout).toHaveTextContent('Brain: Offline'));
    expect(scout).not.toHaveTextContent('Ready');
    status = 'outdated';
    act(() => bridge.emitChanged('link'));
    await waitFor(() => expect(scout).toHaveTextContent('Brain: Needs update'));
    status = 'online';
    act(() => bridge.emitChanged('link'));
    await waitFor(() => expect(scout).toHaveTextContent('Ready'));
  });

  it('ignores a slow host status that arrives after a newer link read', async () => {
    let release: (v: { text: string; ok: boolean }) => void = () => undefined;
    let status: 'online' | 'offline' = 'online';
    const slow: HomeHost = {
      status: () => new Promise((resolve) => (release = resolve)),
    };
    const bridge = Object.assign(createFakeHostBridge({ pets: [SCOUT] }), {
      brainLink: () => Promise.resolve({ addr: 'ws://127.0.0.1:47321', status }),
    });
    renderHome(bridge, { homeHost: slow });
    const scout = await screen.findByRole('region', { name: 'Scout' });
    await waitFor(() => expect(release).not.toBe(undefined));
    status = 'offline';
    act(() => bridge.emitChanged('link'));
    await waitFor(() => expect(scout).toHaveTextContent('Brain: Offline'));
    await act(async () => release({ text: 'Ready', ok: true }));
    expect(scout).toHaveTextContent('Brain: Offline');
  });

  it('ignores a slow status from a previous host after the host changes', async () => {
    let release: (v: { text: string; ok: boolean }) => void = () => undefined;
    const first: HomeHost = { status: () => new Promise((resolve) => (release = resolve)) };
    const second: HomeHost = { status: () => Promise.resolve({ text: 'Second host', ok: true }) };
    const bridge = createFakeHostBridge({ pets: [SCOUT] });
    const tree = (homeHost: HomeHost) => (
      <HostBridgeProvider bridge={bridge}>
        <HomeView host={homeHost} scout={IDLE} settings={<p>The settings form</p>} />
      </HostBridgeProvider>
    );
    const { rerender } = render(tree(first));
    const scout = await screen.findByRole('region', { name: 'Scout' });
    await waitFor(() => expect(release).not.toBe(undefined));
    rerender(tree(second));
    await waitFor(() => expect(scout).toHaveTextContent('Second host'));
    await act(async () => release({ text: 'First host', ok: true }));
    expect(scout).toHaveTextContent('Second host');
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

  it('keeps the mail loops card off Connections and under Held on Tasks', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connections' }));
    expect(screen.queryByText(/read my mail for loops/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.queryByText(/read my mail for loops/i)).toBeNull(); // Jobs is the first tab
    fireEvent.click(await screen.findByRole('tab', { name: /^Held/ }));
    expect(await screen.findByText(/read my mail for loops/i)).toBeInTheDocument();
  });

  it('page tasks shows the Tasks view, and only on its own page', async () => {
    const jobs = [
      {
        id: 'j1',
        task: 'Fix the login bug',
        folder: 'C:\\code\\app',
        mode: 'edit',
        state: 'running',
        title: null,
        startedAt: '2026-10-28T09:00:00.000Z',
        endedAt: null,
        closedAt: null,
        scoutResult: null,
        parts: [],
        activity: false,
      },
    ];
    renderHome(createFakeHostBridge({ pets: [SCOUT], jobs }), { page: 'tasks' });
    expect(await screen.findByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
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
        person_only: false,
        source: 'built_in',
        source_name: 'Built in',
        online: true,
      },
    ];
    renderHome(createFakeHostBridge({ pets: [SCOUT], permissions }), { page: 'settings' });
    expect(await screen.findByText('The settings form')).toBeVisible();
    expect(await screen.findByRole('radiogroup', { name: 'recall' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.queryByRole('radiogroup', { name: 'recall' })).toBeNull();
  });
});
