import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ActivityEntry, Expert, Pet } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { HomeView, type HomeHost, type HomePage } from './home-view';

const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🦊',
  roleId: 'companion',
  roleVersion: 1,
  model: 'haiku',
  providerId: 'claude-code',
  toolGrants: {},
  replyStyle: 'text',
};

const CLAUDE: Expert = {
  id: 'claude-code',
  name: 'Claude Code',
  goodAt: 'Code',
  enabled: true,
  connection: { type: 'claude-code', canEdit: false },
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
        companionId: 'scout',
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
        settings={<p>The settings form</p>}
        {...(props.page === undefined ? {} : { page: props.page })}
        {...(props.onPage === undefined ? {} : { onPage: props.onPage })}
      />
    </HostBridgeProvider>,
  );
}

describe('HomeView', () => {
  it('is one window: Scout and five pages, with no crew and no office', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }));
    const nav = await screen.findByRole('navigation', { name: 'Tagalong' });
    expect(within(nav).getByText('Your companion')).toBeVisible();
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Overview', 'Scout', 'Experts', 'Activity', 'Settings']);
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

  it('opens on the page the host asks for', async () => {
    renderHome(createFakeHostBridge({ pets: [SCOUT] }), { page: 'settings' });
    expect(await screen.findByText('The settings form')).toBeVisible();
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
