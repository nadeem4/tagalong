import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Pet, Role } from '@tagalong/protocol';
import { FIXTURE_ROLES } from '../test-support/fixture-roles';
import { officeTokens } from '../office/tokens';
import { BrainPicker } from './brain-picker';
import { CrewList } from './crew-list';
import { DirectoryCard } from './directory-card';
import { PetSettings } from './pet-settings';
import type { PetDraft } from './pet-settings';
import { RolePicker } from './role-picker';
import { ToolToggles } from './tool-toggles';

const [generalist, backend] = FIXTURE_ROLES as [Role, Role];

const pet = (id: string, name: string, roleId: string): Pet => ({
  id,
  name,
  avatar: '🐾',
  roleId,
  roleVersion: 1,
  model: 'fake-model',
  providerId: 'fake',
  toolGrants: {},
  replyStyle: 'text',
});

const PROVIDERS = [
  { id: 'fake', label: 'Fake' },
  { id: 'openrouter', label: 'OpenRouter' },
];

describe('CrewList', () => {
  const crew = [pet('scout', 'Scout', 'generalist'), pet('bolt', 'Bolt', 'backend-engineer')];

  it('shows each pet with its name and role name', () => {
    render(<CrewList pets={crew} roles={FIXTURE_ROLES} selectedId="scout" onSelect={() => {}} />);
    const bolt = screen.getByRole('button', { name: /Bolt/ });
    expect(bolt).toHaveTextContent('Backend engineer');
    expect(screen.getByRole('button', { name: /Scout/ })).toHaveTextContent('Generalist');
  });

  it('marks the selected pet and reports a pick', () => {
    const onSelect = vi.fn();
    render(<CrewList pets={crew} roles={FIXTURE_ROLES} selectedId="scout" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /Scout/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Bolt/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Bolt/ }));
    expect(onSelect).toHaveBeenCalledWith('bolt');
  });

  it('colours each role label with the ink officeTokens keeps for that role id', () => {
    render(<CrewList pets={crew} roles={FIXTURE_ROLES} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText('Backend engineer')).toHaveStyle({
      color: officeTokens.roleInk['backend-engineer'],
    });
  });

  it('shows no role, never the raw id, while the role library is loading', () => {
    render(<CrewList pets={crew} roles={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: /Bolt/ })).not.toHaveTextContent('backend-engineer');
  });

  it('reads a role the library does not have as Generalist, as the engine runs it', () => {
    render(
      <CrewList
        pets={[pet('sage', 'Sage', 'retired-role')]}
        roles={FIXTURE_ROLES}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Sage/ })).toHaveTextContent('Generalist');
  });
});

describe('RolePicker', () => {
  it('offers one choice per role and shows the chosen role summary and good-at', () => {
    render(
      <RolePicker
        petName="Bolt"
        roles={FIXTURE_ROLES}
        roleId="backend-engineer"
        savedRoleId="backend-engineer"
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /Backend engineer/ })).toBeChecked();
    expect(screen.getByText(backend.summary)).toBeInTheDocument();
    expect(screen.getByText('APIs')).toBeInTheDocument();
    expect(screen.getByText('databases')).toBeInTheDocument();
  });

  it('reports the role picked', () => {
    const onChange = vi.fn();
    render(
      <RolePicker
        petName="Bolt"
        roles={FIXTURE_ROLES}
        roleId="backend-engineer"
        savedRoleId="backend-engineer"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Generalist/ }));
    expect(onChange).toHaveBeenCalledWith('generalist');
  });

  it('warns plainly what a role change replaces and what stays', () => {
    const { rerender } = render(
      <RolePicker
        petName="Bolt"
        roles={FIXTURE_ROLES}
        roleId="backend-engineer"
        savedRoleId="backend-engineer"
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    rerender(
      <RolePicker
        petName="Bolt"
        roles={FIXTURE_ROLES}
        roleId="generalist"
        savedRoleId="backend-engineer"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      "Changing role replaces Bolt's instructions and tools. Name, look, notes and memories stay.",
    );
  });

  it('says the roles are loading when there are none yet', () => {
    render(
      <RolePicker
        petName="Bolt"
        roles={[]}
        roleId="backend-engineer"
        savedRoleId="backend-engineer"
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('Loading roles…')).toBeInTheDocument();
    expect(screen.queryByText(/backend-engineer/)).not.toBeInTheDocument();
  });
});

describe('BrainPicker', () => {
  const base = {
    providers: PROVIDERS,
    providerId: 'openrouter',
    visionModel: '',
    models: ['m-fast', 'm-deep'],
    roleName: 'Backend engineer',
    tier: 'deep' as const,
  };

  it('reports a provider change', () => {
    const onChange = vi.fn();
    render(<BrainPicker {...base} model="m-deep" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'fake' } });
    expect(onChange).toHaveBeenCalledWith({ providerId: 'fake' });
  });

  it('reports a typed model', () => {
    const onChange = vi.fn();
    render(<BrainPicker {...base} model="m-deep" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Model id'), { target: { value: 'm-fast' } });
    expect(onChange).toHaveBeenCalledWith({ model: 'm-fast' });
  });

  it('says Recommended when the model is the recommended one, with no button', () => {
    render(
      <BrainPicker
        {...base}
        model="m-deep"
        recommended={{ model: 'm-deep' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('brain-chip')).toHaveTextContent('Recommended');
    expect(screen.queryByRole('button', { name: 'Use recommended' })).not.toBeInTheDocument();
  });

  it('says Your choice otherwise, and Use recommended sets the model and vision model', () => {
    const onChange = vi.fn();
    render(
      <BrainPicker
        {...base}
        model="m-fast"
        recommended={{ model: 'm-deep', visionModel: 'm-eyes' }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId('brain-chip')).toHaveTextContent('Your choice');
    expect(screen.getByText(/recommended a deep brain: m-deep/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended' }));
    expect(onChange).toHaveBeenCalledWith({ model: 'm-deep', visionModel: 'm-eyes' });
  });

  it('clears the vision model when the recommendation needs none', () => {
    const onChange = vi.fn();
    render(
      <BrainPicker
        {...base}
        model="m-fast"
        visionModel="old-eyes"
        recommended={{ model: 'm-deep' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended' }));
    expect(onChange).toHaveBeenCalledWith({ model: 'm-deep', visionModel: '' });
  });

  it('says Your choice and offers nothing when there is no recommendation', () => {
    render(<BrainPicker {...base} model="m-fast" onChange={() => {}} />);
    expect(screen.getByTestId('brain-chip')).toHaveTextContent('Your choice');
    expect(screen.queryByRole('button', { name: 'Use recommended' })).not.toBeInTheDocument();
  });
});

describe('ToolToggles', () => {
  it('shows one switch per tool the role lists, and no other tool', () => {
    render(<ToolToggles role={backend} grants={{}} onChange={() => {}} />);
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    expect(screen.getByRole('switch', { name: /Read window text/ })).toBeChecked();
    expect(screen.queryByRole('switch', { name: /Look at the screen/ })).not.toBeInTheDocument();
  });

  it('says what each tool does', () => {
    render(<ToolToggles role={backend} grants={{}} onChange={() => {}} />);
    expect(screen.getByText('Remember').closest('li')).toHaveTextContent('saves a memory');
    expect(screen.getByText('Read window text').closest('li')).toHaveTextContent('reads only');
  });

  it('turns a tool off and back on as grants', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ToolToggles role={backend} grants={{ remember: 'allowed' }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('switch', { name: /Watch for a change/ }));
    expect(onChange).toHaveBeenLastCalledWith({ remember: 'allowed', watch_for: 'off' });
    rerender(<ToolToggles role={backend} grants={{ watch_for: 'off' }} onChange={onChange} />);
    const watch = screen.getByRole('switch', { name: /Watch for a change/ });
    expect(watch).not.toBeChecked();
    expect(watch).toHaveTextContent('Off');
    fireEvent.click(watch);
    expect(onChange).toHaveBeenLastCalledWith({ watch_for: 'allowed' });
  });
});

describe('DirectoryCard', () => {
  it('shows what teammates see: name, role, summary, good at, not for, reach and brain', () => {
    render(
      <DirectoryCard
        pet={pet('bolt', 'Bolt', 'backend-engineer')}
        name="Bolt"
        role={backend}
        grants={{ watch_for: 'off' }}
        brain="deep"
      />,
    );
    const card = screen.getByRole('region', { name: 'How teammates see Bolt' });
    expect(card).toHaveTextContent('Backend engineer');
    expect(card).toHaveTextContent(backend.summary);
    expect(card).toHaveTextContent('Good at APIs, databases');
    expect(card).toHaveTextContent('Not for visual design');
    expect(card).toHaveTextContent('Can reach Read window text, Remember');
    expect(card).toHaveTextContent('Brain deep');
    expect(card).toHaveTextContent('Notes and memories are never on the card.');
  });

  it('says so when no tool is on', () => {
    render(
      <DirectoryCard
        pet={pet('bolt', 'Bolt', 'backend-engineer')}
        name="Bolt"
        role={backend}
        grants={{ read_window_text: 'off', watch_for: 'off', remember: 'off' }}
        brain="custom"
      />,
    );
    expect(screen.getByRole('region')).toHaveTextContent('Can reach nothing');
  });
});

describe('PetSettings', () => {
  const draft: PetDraft = {
    name: 'Bolt',
    roleId: 'backend-engineer',
    providerId: 'openrouter',
    model: 'm-deep',
    visionModel: '',
    toolGrants: { watch_for: 'off' },
    notes: 'Be blunt.',
  };

  function renderEditor(onChange = vi.fn(), over: Partial<PetDraft> = {}) {
    render(
      <PetSettings
        pet={pet('bolt', 'Bolt', 'backend-engineer')}
        draft={{ ...draft, ...over }}
        roles={FIXTURE_ROLES}
        providers={PROVIDERS}
        models={[]}
        recommended={{ model: 'm-deep' }}
        onChange={onChange}
      />,
    );
    return onChange;
  }

  it('changing role takes the new role id and starts its tools fresh', () => {
    const onChange = renderEditor();
    fireEvent.click(screen.getByRole('radio', { name: /Generalist/ }));
    expect(onChange).toHaveBeenCalledWith({ ...draft, roleId: 'generalist', toolGrants: {} });
  });

  it('shows only the chosen role tools and the live card', () => {
    renderEditor(undefined, { roleId: 'generalist', toolGrants: {} });
    expect(screen.getAllByRole('switch')).toHaveLength(generalist.tools.length);
    expect(screen.getByRole('note')).toHaveTextContent('Changing role');
    const card = screen.getByRole('region', { name: 'How teammates see Bolt' });
    expect(card).toHaveTextContent('Generalist');
    expect(card).toHaveTextContent('Brain balanced');
  });

  it('edits the private notes and the name', () => {
    const onChange = renderEditor();
    fireEvent.change(screen.getByLabelText('Notes (optional, private)'), {
      target: { value: 'Ask first.' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...draft, notes: 'Ask first.' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Volt' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...draft, name: 'Volt' });
  });

  it('puts the brain tier on the card when the model is the recommended one', () => {
    renderEditor();
    expect(
      within(screen.getByRole('region', { name: 'How teammates see Bolt' })).getByText('deep'),
    ).toBeInTheDocument();
  });
});
