import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CatalogStatus, Expert } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { ExpertsPanel, expertIdFor } from './experts-panel';

const CLAUDE: Expert = {
  id: 'claude-code',
  name: 'Claude Code',
  goodAt: 'Code in this repo',
  enabled: true,
  instructions: '',
  connection: {
    type: 'claude-code',
    canEdit: false,
    canSearchWeb: false,
    plugins: [],
    mcpTools: [],
    workspace: 'project',
  },
};

const RESEARCHER: CatalogStatus = {
  entry: {
    id: 'researcher',
    name: 'Researcher',
    line: 'Looks things up and sums up, with sources.',
    goodAt: 'Research with sources',
    instructions: 'Link every source.',
    canEdit: false,
    canSearchWeb: true,
    workspace: 'own',
    plugins: [
      { id: 'firecrawl@claude-plugins-official', name: 'Firecrawl' },
      { id: 'notion@claude-plugins-official', name: 'Notion' },
    ],
    apps: [
      {
        name: 'Notion',
        server: 'plugin:Notion:notion',
        tools: ['mcp__plugin_Notion_notion__notion-search'],
        optional: true,
      },
      {
        name: 'Google Calendar',
        server: 'claude.ai Google Calendar',
        tools: ['mcp__claude_ai_Google_Calendar__list_events'],
        optional: true,
      },
    ],
    mayDo: 'Reads the web. Never posts anything.',
  },
  plugins: [
    { id: 'firecrawl@claude-plugins-official', name: 'Firecrawl', installed: false },
    { id: 'notion@claude-plugins-official', name: 'Notion', installed: true },
  ],
  apps: [
    { name: 'Notion', found: true, optional: true },
    { name: 'Google Calendar', found: false, optional: true },
  ],
};

/** The same entry with every plugin installed. */
const READY: CatalogStatus = {
  ...RESEARCHER,
  plugins: RESEARCHER.plugins.map((plugin) => ({ ...plugin, installed: true })),
};

/** Add expert, then a template from the picker. */
async function startFrom(template: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Add expert' }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${template}`) }));
}

function renderPanel(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ExpertsPanel />
    </HostBridgeProvider>,
  );
}

describe('ExpertsPanel', () => {
  it('says what experts are when there are none, and offers to add one', async () => {
    renderPanel(createFakeHostBridge());
    expect(await screen.findByText(/No experts yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add expert' })).toBeInTheDocument();
  });

  it('lists each expert, and whether it is on and may edit, in words', async () => {
    renderPanel(
      createFakeHostBridge({
        experts: [CLAUDE, { ...CLAUDE, id: 'docs', name: 'Docs helper', enabled: false }],
      }),
    );
    const list = await screen.findByRole('list', { name: 'Experts' });
    const rows = within(list).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Claude Code');
    expect(rows[0]).toHaveTextContent('Asks which project for each task');
    expect(rows[0]).toHaveTextContent('On');
    expect(rows[0]).toHaveTextContent('Reads only');
    expect(rows[1]).toHaveTextContent('Off');
  });

  it('adds a Claude Code expert from Blank, saves it, and tests the connection', async () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);
    await startFrom('Blank');

    expect(screen.getByLabelText('Name')).toHaveValue('Claude Code');
    fireEvent.change(screen.getByLabelText('Good at'), {
      target: { value: 'Code changes and tests' },
    });
    expect(screen.queryByLabelText(/project folder/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved. Claude Code is ready.');
    expect(bridge.experts).toEqual([
      {
        id: 'claude-code',
        name: 'Claude Code',
        goodAt: 'Code changes and tests',
        enabled: true,
        instructions: '',
        connection: {
          type: 'claude-code',
          canEdit: false,
          canSearchWeb: false,
          plugins: [],
          mcpTools: [],
          workspace: 'project',
        },
      },
    ]);
    expect(bridge.testedExperts).toEqual(['claude-code']);
  });

  it('says plainly when the expert cannot be reached, but keeps it saved', async () => {
    const bridge = createFakeHostBridge({
      testExpert: () => ({ ok: false, error: '"claude" was not found on the PATH.' }),
    });
    renderPanel(bridge);
    await startFrom('Blank');
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved, but Claude Code cannot be reached: "claude" was not found on the PATH.',
    );
    expect(bridge.experts).toHaveLength(1);
  });

  it('saves without a folder: the project is chosen for each task', async () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);
    await startFrom('Blank');
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved. Claude Code is ready.');
    expect(bridge.experts[0]?.connection).toEqual({
      type: 'claude-code',
      canEdit: false,
      canSearchWeb: false,
      plugins: [],
      mcpTools: [],
      workspace: 'project',
    });
  });

  it('drops a default folder an old expert still carries when it is saved again', async () => {
    const bridge = createFakeHostBridge({
      experts: [
        {
          ...CLAUDE,
          connection: {
            type: 'claude-code',
            folder: 'C:\\old',
            canEdit: false,
            canSearchWeb: false,
            plugins: [],
            mcpTools: [],
            workspace: 'project',
          },
        },
      ],
    });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    await screen.findByRole('status');
    expect(bridge.experts[0]?.connection).toEqual({
      type: 'claude-code',
      canEdit: false,
      canSearchWeb: false,
      plugins: [],
      mcpTools: [],
      workspace: 'project',
    });
  });

  it('edits an expert: lets it edit files and switches it off', async () => {
    const bridge = createFakeHostBridge({ experts: [CLAUDE] });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    const edit = screen.getByRole('switch', { name: 'Let it edit files by default' });
    expect(edit).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(edit);
    expect(edit).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'On' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    await screen.findByRole('status');
    expect(bridge.experts[0]).toMatchObject({
      id: 'claude-code',
      enabled: false,
      connection: { canEdit: true },
    });
  });

  it('starts Add expert with a choice of templates', async () => {
    renderPanel(createFakeHostBridge());
    fireEvent.click(await screen.findByRole('button', { name: 'Add expert' }));
    for (const name of ['Coder', 'Debugger', 'Designer', 'Reviewer', 'Blank']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Name')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to experts' }));
    expect(screen.queryByRole('button', { name: /^Debugger/ })).toBeNull();
    expect(screen.getByText(/No experts yet/)).toBeInTheDocument();
  });

  it('fills the form from the Debugger template: read-only, with its instructions shown', async () => {
    renderPanel(createFakeHostBridge());
    await startFrom('Debugger');
    expect(screen.getByLabelText('Name')).toHaveValue('Debugger');
    expect(screen.getByLabelText('Good at')).toHaveValue(
      'Finding why something breaks, reading logs and stack traces',
    );
    expect((screen.getByLabelText('Standing instructions') as HTMLTextAreaElement).value).toContain(
      'find the cause before suggesting anything',
    );
    expect(screen.getByRole('switch', { name: 'Let it edit files by default' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Let it search the web' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('fills the form from the Reviewer template: reads only, told to review a diff', async () => {
    renderPanel(createFakeHostBridge());
    await startFrom('Reviewer');
    expect(screen.getByLabelText('Name')).toHaveValue('Reviewer');
    expect(screen.getByLabelText('Good at')).toHaveValue(
      'Checking a change for bugs, missing tests and unclear code',
    );
    expect((screen.getByLabelText('Standing instructions') as HTMLTextAreaElement).value).toContain(
      'the files the brief names',
    );
    expect(screen.getByRole('switch', { name: 'Let it edit files by default' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Let it search the web' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('starts Coder able to edit', async () => {
    renderPanel(createFakeHostBridge());
    await startFrom('Coder');
    expect(screen.getByRole('switch', { name: 'Let it edit files by default' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('Blank is the plain form: no instructions, reads only, no web', async () => {
    renderPanel(createFakeHostBridge());
    await startFrom('Blank');
    expect(screen.getByLabelText('Name')).toHaveValue('Claude Code');
    expect(screen.getByLabelText('Good at')).toHaveValue('');
    expect(screen.getByLabelText('Standing instructions')).toHaveValue('');
    expect(screen.getByRole('switch', { name: 'Let it search the web' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  describe('from the catalog', () => {
    async function openCatalog(bridge: FakeHostBridge) {
      renderPanel(bridge);
      fireEvent.click(await screen.findByRole('button', { name: 'Add expert' }));
      return screen.findByRole('region', { name: 'Researcher' });
    }

    it('shows each entry below the templates, with what it uses, its apps and what it may do', async () => {
      const card = await openCatalog(createFakeHostBridge({ catalog: [RESEARCHER] }));
      expect(screen.getByRole('heading', { name: 'From the catalog' })).toBeInTheDocument();
      expect(within(card).getByText(/Looks things up/)).toBeInTheDocument();
      const uses = within(card).getByRole('list', { name: 'Uses' });
      expect(uses).toHaveTextContent('FirecrawlMissing');
      expect(uses).toHaveTextContent('NotionInstalled');
      const apps = within(card).getByRole('list', { name: 'Apps' });
      expect(apps).toHaveTextContent('Notion: found in Claude Code');
      expect(apps).toHaveTextContent('Google Calendar: not set up (optional)');
      expect(within(card).getByText('Reads the web. Never posts anything.')).toBeInTheDocument();
      // The exact tools it is allowed, and nothing else.
      const tools = within(card).getByRole('list', { name: 'Allowed app tools' });
      expect(
        within(tools)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual([
        'mcp__plugin_Notion_notion__notion-search',
        'mcp__claude_ai_Google_Calendar__list_events',
      ]);
    });

    it('asks first, naming each plugin it will install, then installs and opens the filled form', async () => {
      const bridge = createFakeHostBridge({ catalog: [RESEARCHER] });
      const card = await openCatalog(bridge);
      fireEvent.click(within(card).getByRole('button', { name: 'Install Researcher' }));
      expect(bridge.installedCatalog).toEqual([]);
      const confirm = screen.getByRole('region', { name: 'Install Researcher?' });
      expect(confirm).toHaveTextContent('firecrawl@claude-plugins-official');
      expect(confirm).not.toHaveTextContent('notion@claude-plugins-official');
      expect(confirm).toHaveTextContent('claude plugin install');

      fireEvent.click(within(confirm).getByRole('button', { name: 'Install and continue' }));
      expect(await screen.findByLabelText('Name')).toHaveValue('Researcher');
      expect(bridge.installedCatalog).toEqual(['researcher']);
      expect(screen.getByLabelText('Standing instructions')).toHaveValue('Link every source.');
      expect(screen.getByText(/Works in its own folder/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
      await screen.findByRole('status');
      expect(bridge.experts[0]).toMatchObject({
        id: 'researcher',
        catalogId: 'researcher',
        connection: {
          canSearchWeb: true,
          workspace: 'own',
          plugins: ['firecrawl@claude-plugins-official', 'notion@claude-plugins-official'],
          mcpTools: [
            'mcp__plugin_Notion_notion__notion-search',
            'mcp__claude_ai_Google_Calendar__list_events',
          ],
        },
      });
    });

    it('installs nothing when every plugin is there, and goes straight on', async () => {
      const bridge = createFakeHostBridge({ catalog: [READY] });
      const card = await openCatalog(bridge);
      fireEvent.click(within(card).getByRole('button', { name: 'Install Researcher' }));
      const confirm = screen.getByRole('region', { name: 'Install Researcher?' });
      expect(confirm).toHaveTextContent('Nothing to install');
      fireEvent.click(within(confirm).getByRole('button', { name: 'Continue' }));
      expect(await screen.findByLabelText('Name')).toHaveValue('Researcher');
      expect(bridge.installedCatalog).toEqual([]);
    });

    it('says plainly when an install fails, and stays on the card', async () => {
      const bridge = createFakeHostBridge({
        catalog: [RESEARCHER],
        installExpert: () => ({
          ok: false,
          installed: [],
          error: 'Could not install firecrawl@claude-plugins-official: offline',
        }),
      });
      const card = await openCatalog(bridge);
      fireEvent.click(within(card).getByRole('button', { name: 'Install Researcher' }));
      fireEvent.click(screen.getByRole('button', { name: 'Install and continue' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('offline');
      expect(screen.queryByLabelText('Name')).toBeNull();
    });

    it('goes back from the confirm card without installing', async () => {
      const bridge = createFakeHostBridge({ catalog: [RESEARCHER] });
      const card = await openCatalog(bridge);
      fireEvent.click(within(card).getByRole('button', { name: 'Install Researcher' }));
      fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
      expect(screen.queryByRole('region', { name: 'Install Researcher?' })).toBeNull();
      expect(bridge.installedCatalog).toEqual([]);
    });

    it('keeps a catalog expert’s bundle when it is edited and saved again', async () => {
      const saved: Expert = {
        ...CLAUDE,
        id: 'researcher',
        name: 'Researcher',
        catalogId: 'researcher',
        connection: {
          ...CLAUDE.connection,
          workspace: 'own',
          plugins: ['notion@claude-plugins-official'],
          mcpTools: ['mcp__plugin_Notion_notion__notion-search'],
        },
      };
      const bridge = createFakeHostBridge({ experts: [saved] });
      renderPanel(bridge);
      const row = await screen.findByRole('button', { name: /Researcher/ });
      expect(row).toHaveTextContent('Works in its own folder');
      fireEvent.click(row);
      fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
      await screen.findByRole('status');
      expect(bridge.experts[0]).toEqual(saved);
    });
  });

  it('edits an expert with no picker, showing its standing instructions', async () => {
    const bridge = createFakeHostBridge({
      experts: [{ ...CLAUDE, instructions: 'Keep answers short.' }],
    });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    expect(screen.queryByRole('button', { name: /^Debugger/ })).toBeNull();
    expect(screen.getByLabelText('Standing instructions')).toHaveValue('Keep answers short.');
  });

  it('deletes an expert after asking once', async () => {
    const bridge = createFakeHostBridge({ experts: [CLAUDE] });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Claude Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Claude Code for good' }));
    expect(await screen.findByText(/No experts yet/)).toBeInTheDocument();
    expect(bridge.experts).toEqual([]);
  });
});

describe('expertIdFor', () => {
  it('makes a kebab-case id from the name, unique among the others', () => {
    expect(expertIdFor('Claude Code', [])).toBe('claude-code');
    expect(expertIdFor('Claude Code', ['claude-code'])).toBe('claude-code-2');
    expect(expertIdFor('  ', [])).toBe('expert');
  });
});
