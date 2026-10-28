/** Tests for HomeView: the nav, pages and Scout's page. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ActivityEntry, Ask, Expert, Pet } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { HomeView, type HomeHost, type HomePage } from './home-view';

/** A fake idle strip: the host passes Bean's real one. */
const IDLE = { src: 'idle.webp', frames: 36, fps: 12, loop: true };

const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🦊',
  roleId: 'companion',
  model: 'haiku',
  providerId: 'claude-code',
};

const CLAUDE: Expert = {
  id: 'claude-code',
  name: 'Claude Code',
  goodAt: 'Code',
  enabled: true,
  instructions: '',
  connection: {
    type: 'claude-code',
    canEdit: false,
    canSearchWeb: false,
    plugins: [],
    mcpTools: [],
    workspace: 'project' as const,
  },
};

const HANDED: ActivityEntry = {
  id: 'x1',
  kind: 'expert',
  state: 'done',
  petId: 'scout',
  startedAt: '2026-10-12T11:44:00.000Z',
  expertId: 'claude-code',
  expertName: 'Claude Code',
  text: 'Find why the shutdown test fails',
};

function host(saved: Pet[] = []): HomeHost {
  return {
    setup: () =>
      Promise.resolve({
        providers: [
          { id: 'claude-code', label: 'Your Claude sign-in', needsKey: false },
          { id: 'anthropic', label: 'Anthropic', needsKey: true },
        ],
      }),
    listModels: (providerId) =>
      Promise.resolve({
        models: providerId === 'anthropic' ? ['claude-sonnet-5'] : ['haiku', 'sonnet'],
        source: 'fallback',
      }),
    savePet: (pet) => {
      saved.push(pet);
      return Promise.resolve(pet);
    },
  };
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
  it('is one window: Scout and twelve pages', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    expect(within(nav).getByText('Your companion')).toBeVisible();
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Overview',
      'Waiting on you',
      'Scout',
      'Experts',
      'Routines',
      'Connections',
      'Activity',
      'How Scout decided',
      'What Scout saw',
      'What Scout remembers',
      'What Scout learned',
      'Settings',
    ]);
  });

  it('counts what waits on you in the nav, and follows asks.changed', async () => {
    const waiting: Ask = {
      id: '40000000-0000-4000-8000-000000000001',
      kind: 'app-change',
      petId: 'scout',
      summary: 'Create a page',
      risk: 'change',
      app: 'Notion',
      tool: 'create_page',
      state: 'waiting',
      createdAt: '2026-10-22T10:00:00.000Z',
    };
    const bridge = createFakeHostBridge({
      pets: [SCOUT],
      savedAsks: [waiting, { ...waiting, id: '40000000-0000-4000-8000-000000000002' }],
    });
    renderHome(bridge);
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    expect(await within(nav).findByRole('button', { name: 'Waiting on you (2)' })).toBeVisible();
    act(() => bridge.emit({ type: 'asks.changed', waiting: [waiting] }));
    expect(within(nav).getByRole('button', { name: 'Waiting on you (1)' })).toBeVisible();
    act(() => bridge.emit({ type: 'asks.changed', waiting: [] }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Waiting on you' }));
    expect(await screen.findByRole('heading', { name: 'Waiting on you' })).toBeVisible();
  });

  it("leaves the count alone when a brain ask's card is dismissed", async () => {
    const waiting: Ask = {
      id: '40000000-0000-4000-8000-000000000001',
      kind: 'app-change',
      petId: 'scout',
      summary: 'Create a page',
      risk: 'change',
      app: 'Notion',
      tool: 'create_page',
      state: 'waiting',
      createdAt: '2026-10-22T10:00:00.000Z',
    };
    const bridge = createFakeHostBridge({ pets: [SCOUT], savedAsks: [waiting] });
    renderHome(bridge);
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    expect(await within(nav).findByRole('button', { name: 'Waiting on you (1)' })).toBeVisible();
    act(() => bridge.emit({ type: 'connector.dismiss', approvalId: 'brain-ask' }));
    expect(within(nav).getByRole('button', { name: 'Waiting on you (1)' })).toBeVisible();
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

  it('opens Routines with Scout’s card in the form when the host hands one over', async () => {
    const routineDraft = {
      proposalId: '60000000-0000-4000-8000-000000000001',
      petId: 'scout',
      action: 'create' as const,
      routine: {
        name: 'Morning papers',
        when: { type: 'launch' as const },
        what: 'Papers.',
        enabled: true,
        topics: '',
        deliver: { bubble: true, voice: false, notification: false },
        uses: [],
      },
    };
    render(
      <HostBridgeProvider bridge={createFakeHostBridge({ pets: [SCOUT] })}>
        <HomeView
          host={host()}
          scout={IDLE}
          settings={<p>The settings form</p>}
          page="routines"
          routineDraft={routineDraft}
        />
      </HostBridgeProvider>,
    );
    expect(await screen.findByLabelText('Name')).toHaveValue('Morning papers');
  });

  it('opens on an overview: how Scout thinks, the experts, and what happened lately', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT], experts: [CLAUDE], activity: [HANDED] }));
    const scout = await screen.findByRole('region', { name: 'Scout' });
    await waitFor(() => expect(scout).toHaveTextContent('Thinks with your Claude sign-in · Haiku'));
    expect(scout).toHaveTextContent('Never at its blind spots.');
    const experts = screen.getByRole('region', { name: 'Experts' });
    await waitFor(() => expect(experts).toHaveTextContent('Claude Code'));
    expect(experts).toHaveTextContent('Ready');
    const recent = screen.getByRole('region', { name: 'Recent' });
    await waitFor(() => expect(recent).toHaveTextContent('Find why the shutdown test fails'));
  });

  it('keeps a routine being edited when you switch pages, and never reopens a saved card', async () => {
    const routineDraft = {
      proposalId: '60000000-0000-4000-8000-000000000002',
      petId: 'scout',
      action: 'create' as const,
      routine: {
        name: 'Morning papers',
        when: { type: 'launch' as const },
        what: 'Papers.',
        enabled: true,
        topics: '',
        deliver: { bubble: true, voice: false, notification: false },
        uses: [],
      },
    };
    const bridge = createFakeHostBridge({ pets: [SCOUT] });
    render(
      <HostBridgeProvider bridge={bridge}>
        <HomeView
          host={host()}
          scout={IDLE}
          settings={<p>The settings form</p>}
          page="routines"
          routineDraft={routineDraft}
        />
      </HostBridgeProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'My papers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Experts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Routines' }));
    expect(screen.getByLabelText('Name')).toHaveValue('My papers');

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(bridge.confirmedRoutines).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Routines' }));
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('says what is really wrong with Scout instead of Ready', async () => {
    const signedOut: HomeHost = {
      ...host(),
      status: () => Promise.resolve({ text: 'Signed out of Claude Code', ok: false }),
    };
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), { homeHost: signedOut });
    const scout = await screen.findByRole('region', { name: 'Scout' });
    await waitFor(() => expect(scout).toHaveTextContent('Signed out of Claude Code'));
    expect(scout).not.toHaveTextContent('Ready');
  });

  it('moves between pages, and reports the page to the host', async () => {
    const pages: HomePage[] = [];
    renderHome(createFakeHostBridge({ pets: [SCOUT], experts: [CLAUDE] }), {
      onPage: (page) => pages.push(page),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Experts' }));
    expect(await screen.findByRole('button', { name: 'Add expert' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('The settings form')).toBeVisible();
    expect(pages).toEqual(['experts', 'settings']);
  });

  it('shows Jobs above the experts list on the Experts page only', async () => {
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
    renderHome(createFakeHostBridge({ pets: [SCOUT], experts: [CLAUDE], jobs }), {
      page: 'experts',
    });
    const panel = await screen.findByRole('region', { name: 'Jobs' });
    expect(within(panel).getByText('Fix the login bug')).toBeVisible();
    expect(
      panel.compareDocumentPosition(await screen.findByRole('button', { name: 'Add expert' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.queryByRole('region', { name: 'Jobs' })).toBeNull();
  });

  it('shows What Scout saw after How Scout decided, kept as the host says', async () => {
    const days: HomeHost = {
      ...host(),
      setup: async () => ({ ...(await host().setup()), sightLogDays: 3 }),
    };
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), { homeHost: days });
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels.slice(-5)).toEqual([
      'How Scout decided',
      'What Scout saw',
      'What Scout remembers',
      'What Scout learned',
      'Settings',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'What Scout saw' }));
    expect(await screen.findByText("Scout hasn't looked at anything yet.")).toBeVisible();
    expect(screen.getByText(/^Kept 3 days\./)).toBeVisible();
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

  it('changes how Scout thinks: provider and model, saved on Save', async () => {
    const saved: Pet[] = [];
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), { page: 'scout', homeHost: host(saved) });
    const provider = await screen.findByLabelText('Thinks with');
    await waitFor(() => expect(provider).toHaveValue('claude-code'));
    fireEvent.change(provider, { target: { value: 'anthropic' } });
    const model = screen.getByLabelText('Model');
    await waitFor(() => expect(model).toHaveValue('claude-sonnet-5'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(saved[0]).toMatchObject({
      id: 'scout',
      providerId: 'anthropic',
      model: 'claude-sonnet-5',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('says which services need a key, and recommends Haiku on the Claude sign-in', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), { page: 'scout' });
    const provider = await screen.findByLabelText('Thinks with');
    await waitFor(() => expect(provider).toHaveValue('claude-code'));
    expect(
      within(provider)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Your Claude sign-in (no key)', 'Anthropic (API key)']);
    const model = screen.getByLabelText('Model');
    await waitFor(() =>
      expect(
        within(model)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Haiku (quick, recommended)', 'Sonnet']),
    );
  });

  it('points to the stored keys in Settings', async () => {
    const pages: HomePage[] = [];
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), {
      page: 'scout',
      onPage: (page) => pages.push(page),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Settings, under Advanced' }));
    expect(await screen.findByText('The settings form')).toBeVisible();
    expect(pages).toEqual(['settings']);
  });

  it('keeps the Scout page usable when the model list cannot be read', async () => {
    const failing: HomeHost = {
      ...host(),
      listModels: () => Promise.reject(new Error('no provider')),
    };
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), { page: 'scout', homeHost: failing });
    const model = await screen.findByLabelText('Model');
    await waitFor(() => expect(model).toHaveValue('haiku'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/model list/i);
  });
});
