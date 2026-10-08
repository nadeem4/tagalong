import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet, Role } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { OFFICE_CSS } from '../office/office-styles';
import type { AgentHost } from './agent-controls';
import { HomeView } from './home-view';
import { officeTheme } from './office-theme';
import type { SceneProps, Theme } from './theme';

const pet = (id: string, name: string, roleId: string, color?: string): Pet => ({
  id,
  name,
  avatar: '🐾',
  ...(color !== undefined ? { color } : {}),
  roleId,
  roleVersion: 1,
  model: 'fake',
  providerId: 'fake',
  toolGrants: {},
  replyStyle: 'text',
});

const CREW: Pet[] = [
  pet('scout', 'Scout', 'generalist'),
  pet('ink', 'Ink', 'writer'),
  pet('bolt', 'Bolt', 'backend-engineer'),
  pet('sage', 'Sage', 'wizard', '#5dbb63'),
];

const role = (id: string, name: string): Role => ({
  id,
  name,
  version: 1,
  summary: `${name}.`,
  goodAt: ['things'],
  notFor: ['other things'],
  tools: [],
  model: { tier: 'balanced', needsVision: false },
  instructions: `You are a ${name}.`,
});

const ROLES: Role[] = [
  role('generalist', 'Generalist'),
  role('writer', 'Writer'),
  role('backend-engineer', 'Backend engineer'),
  role('researcher', 'Researcher'),
];
const T1 = '10000000-0000-4000-8000-000000000001';

function fakeAgentHost(): AgentHost {
  return {
    setup: () =>
      Promise.resolve({ providers: [{ id: 'fake', label: 'Fake' }], desktopPetId: 'scout' }),
    listModels: () => Promise.resolve({ models: [], source: 'fallback' }),
    savePet: (saved) => Promise.resolve(saved),
    deletePet: () => Promise.resolve(true),
    setDesktopPet: () => Promise.resolve(),
  };
}

async function renderHome(
  bridge: FakeHostBridge = createFakeHostBridge({ pets: CREW, roles: ROLES }),
  props: { theme?: Theme; agentHost?: AgentHost } = {},
) {
  const view = render(
    <HostBridgeProvider bridge={bridge}>
      <HomeView {...props} />
    </HostBridgeProvider>,
  );
  await screen.findByRole('button', { name: /Scout/ });
  return { bridge, view };
}

function agentRow(name: string): HTMLElement {
  return within(screen.getByRole('navigation', { name: 'Agents' })).getByRole('button', {
    name: new RegExp(name),
  });
}

describe('HomeView', () => {
  it('is called Home', async () => {
    await renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Home');
  });

  it('lists the whole crew in the agent list with job labels and an at-desk status', async () => {
    await renderHome();
    const agents = screen.getByRole('navigation', { name: 'Agents' });
    expect(agents).toHaveTextContent('AGENTS · 4');
    expect(agentRow('Scout')).toHaveTextContent('GENERALIST');
    expect(agentRow('Ink')).toHaveTextContent('WRITER');
    expect(agentRow('Bolt')).toHaveTextContent('BACKEND ENGINEER');
    // Sage's role is not in the library, so it works as a generalist.
    expect(agentRow('Sage')).toHaveTextContent('GENERALIST');
    for (const name of ['Scout', 'Ink', 'Bolt', 'Sage']) {
      expect(agentRow(name)).toHaveTextContent('At desk');
    }
  });

  it('labels a pet by its role, not its id', async () => {
    const crew = [pet('scout', 'Scout', 'researcher'), pet('pip', 'Pip', 'writer')];
    await renderHome(createFakeHostBridge({ pets: crew, roles: ROLES }));
    expect(agentRow('Scout')).toHaveTextContent('RESEARCHER');
    expect(agentRow('Scout')).not.toHaveTextContent('GENERALIST');
    expect(agentRow('Pip')).toHaveTextContent('WRITER');
  });

  it('still shows the crew when the roles cannot be listed', async () => {
    const bridge = createFakeHostBridge({ pets: CREW, roles: ROLES });
    bridge.listRoles = () => Promise.reject(new Error('old engine'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderHome(bridge);
    expect(agentRow('Ink')).toHaveTextContent('GENERALIST');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('puts every pet at a named desk on the office floor', async () => {
    await renderHome();
    const floor = screen.getByRole('region', { name: 'Office floor' });
    for (const name of ['SCOUT', 'INK', 'BOLT', 'SAGE']) expect(floor).toHaveTextContent(name);
  });

  it('shows a pet working, with its monitor lit, while its turn is in flight', async () => {
    const { bridge } = await renderHome();
    act(() => bridge.emit({ type: 'turn.started', turnId: T1, petId: 'ink', conversationId: T1 }));
    expect(agentRow('Ink')).toHaveTextContent('Working');
    expect(screen.getByTestId('monitor-ink')).toHaveAttribute('data-lit', 'true');
    expect(screen.getByTestId('monitor-scout')).toHaveAttribute('data-lit', 'false');

    act(() =>
      bridge.emit({
        type: 'turn.completed',
        turnId: T1,
        text: 'done',
        stopReason: 'end',
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    );
    expect(agentRow('Ink')).toHaveTextContent('At desk');
    expect(screen.getByTestId('monitor-ink')).toHaveAttribute('data-lit', 'false');
  });

  it('selects the first agent, and moves the selection and the cursor on click', async () => {
    await renderHome();
    expect(agentRow('Scout')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('office-cursor')).toHaveAttribute('data-pet-id', 'scout');

    fireEvent.click(agentRow('Bolt'));
    expect(agentRow('Bolt')).toHaveAttribute('aria-pressed', 'true');
    expect(agentRow('Scout')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('office-cursor')).toHaveAttribute('data-pet-id', 'bolt');
  });

  it('shows both rooms free, and keeps the empty meetings state where meetings will appear', async () => {
    await renderHome();
    expect(screen.getByText('2 of 2 rooms free')).toBeInTheDocument();
    const floor = screen.getByRole('region', { name: 'Office floor' });
    expect(within(floor).getAllByText('Free')).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: 'Meetings' }));
    const meetings = screen.getByRole('complementary', { name: 'Meetings' });
    expect(meetings).toHaveTextContent('When pets meet, their meetings appear here');
  });

  it('shows task assignment as not yet available rather than pretending', async () => {
    await renderHome();
    const field = screen.getByLabelText('Assign a task');
    expect(field).toBeDisabled();
    const assign = screen.getByRole('button', { name: 'Assign' });
    expect(assign).toBeDisabled();
    expect(assign).toHaveAttribute('title', 'Task assignment arrives in a later update');
    expect(field.closest('[title]')).toHaveAttribute(
      'title',
      'Task assignment arrives in a later update',
    );
  });

  it('says so when the crew cannot be reached', async () => {
    const bridge = createFakeHostBridge({ pets: CREW, roles: ROLES });
    bridge.listPets = () => Promise.reject(new Error('engine down'));
    render(
      <HostBridgeProvider bridge={bridge}>
        <HomeView />
      </HostBridgeProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the crew');
  });
});

describe('Home’s side panel', () => {
  const tab = (name: string) => screen.getByRole('tab', { name });

  it('opens on the activity view', async () => {
    await renderHome();
    expect(tab('Activity')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Activity' })).toBeVisible();
  });

  it('shows an agent’s controls when it is picked in the agent list', async () => {
    await renderHome(undefined, { agentHost: fakeAgentHost() });
    fireEvent.click(agentRow('Ink'));
    expect(tab('Ink')).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: 'Ink' });
    expect(await within(panel).findByRole('radio', { name: 'Writer' })).toBeChecked();
    expect(within(panel).getByRole('button', { name: 'Save Ink' })).toBeInTheDocument();
    expect(within(panel).getByRole('group', { name: 'Desktop pet' })).toBeInTheDocument();
  });

  it('says where agents are changed when the host cannot change them', async () => {
    await renderHome();
    fireEvent.click(agentRow('Ink'));
    expect(screen.getByRole('tabpanel', { name: 'Ink' })).toHaveTextContent(
      'Agents can be changed in the Tagalong desktop app.',
    );
  });

  it('moves between tabs with the arrow keys', async () => {
    await renderHome();
    fireEvent.keyDown(tab('Activity'), { key: 'ArrowRight' });
    expect(tab('Scout')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Scout')).toHaveFocus();
    fireEvent.keyDown(tab('Scout'), { key: 'ArrowLeft' });
    expect(tab('Activity')).toHaveAttribute('aria-selected', 'true');
  });

  it('renames an agent in the list once its controls are saved', async () => {
    await renderHome(undefined, { agentHost: fakeAgentHost() });
    fireEvent.click(agentRow('Bolt'));
    const panel = screen.getByRole('tabpanel', { name: 'Bolt' });
    fireEvent.change(await within(panel).findByLabelText('Name'), { target: { value: 'Volt' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save Volt' }));
    const agents = screen.getByRole('navigation', { name: 'Agents' });
    expect(await within(agents).findByText('Volt')).toBeInTheDocument();
  });
});

describe('themes', () => {
  /** A second theme: a different scene, nothing else. */
  function FakeScene({ placements }: SceneProps) {
    return <section aria-label="Fake scene">{placements.length} placed</section>;
  }
  const fakeTheme: Theme = {
    ...officeTheme,
    id: 'fake',
    name: 'Fake',
    tokens: { ground: '#000000', grid: '#111111', wall: '#222222' },
    Scene: FakeScene,
  };

  /** Everything Home draws outside its centre scene, with React's per-root ids evened out. */
  function chrome(container: HTMLElement): string[] {
    return ['header', 'nav', '[role="tablist"]', '[role="tabpanel"]'].map((selector) =>
      [...container.querySelectorAll(selector)]
        .map((node) => node.outerHTML.replace(/_r_[0-9a-z]+_/g, 'id'))
        .join(''),
    );
  }

  it('changes only the centre scene: the chrome is identical in every theme', async () => {
    const office = await renderHome();
    const officeChrome = chrome(office.view.container);
    expect(screen.getByRole('region', { name: 'Office floor' })).toBeInTheDocument();
    office.view.unmount();

    const other = await renderHome(undefined, { theme: fakeTheme });
    expect(screen.getByRole('region', { name: 'Fake scene' })).toHaveTextContent('4 placed');
    expect(screen.queryByRole('region', { name: 'Office floor' })).toBeNull();
    expect(chrome(other.view.container)).toEqual(officeChrome);
  });
});

describe('the Still office toggle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const still = () => screen.getByRole('button', { name: 'Still office' });
  const root = () => screen.getByRole('navigation', { name: 'Agents' }).closest('.office');

  it('stops the bob and the cursor hop, and remembers the choice', async () => {
    await renderHome();
    expect(still()).toHaveAttribute('aria-pressed', 'false');
    expect(root()).not.toHaveClass('office-still');

    fireEvent.click(still());
    expect(still()).toHaveAttribute('aria-pressed', 'true');
    expect(root()).toHaveClass('office-still');
    expect(localStorage.getItem('tagalong.office.still')).toBe('1');

    fireEvent.click(still());
    expect(root()).not.toHaveClass('office-still');
    expect(localStorage.getItem('tagalong.office.still')).toBe('0');
  });

  it('opens still when the choice was remembered', async () => {
    localStorage.setItem('tagalong.office.still', '1');
    await renderHome();
    expect(still()).toHaveAttribute('aria-pressed', 'true');
  });

  it('still toggles when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await renderHome();
    fireEvent.click(still());
    expect(still()).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches the animations off in the stylesheet', () => {
    expect(OFFICE_CSS).toMatch(
      /\.office-still \.office-bob,\s*\.office-still \.office-hop\s*\{\s*animation: none;/,
    );
  });
});
