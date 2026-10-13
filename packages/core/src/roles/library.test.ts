import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Role } from '@tagalong/protocol';
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_FILE,
  ROLES_DIR,
  loadRoles,
  parseRoleFile,
  renderLibrary,
} from '../../scripts/gen-roles.mjs';
import { getRole, listRoles, roleFor } from './index';
import { ROLE_LIBRARY } from './library.generated';

/** Every built-in tool a role may name. Update when a built-in tool is added or renamed. */
const BUILT_IN_TOOLS = [
  'look_at_screen',
  'get_selection',
  'list_displays',
  'look_at_display',
  'look_closer',
  'list_windows',
  'read_window_text',
  'recall_screen',
  'what_changed',
  'watch_for',
  'remember',
  'ask_pet',
  'hand_to_expert',
];

const roleFiles = readdirSync(ROLES_DIR)
  .filter((file) => file.endsWith('.md'))
  .map((file) => join(ROLES_DIR, file));

const lf = (text: string): string => text.replace(/\r\n/g, '\n');

describe('the role files', () => {
  it('include the six shipped roles', () => {
    expect(roleFiles.map((file) => basename(file, '.md')).sort()).toEqual([
      'backend-engineer',
      'companion',
      'frontend-engineer',
      'generalist',
      'researcher',
      'writer',
    ]);
  });

  it.each(roleFiles)('%s is a valid role', (file) => {
    const parsed = Role.safeParse(parseRoleFile(readFileSync(file, 'utf8')));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it.each(roleFiles)('%s names its role by its file name', (file) => {
    const role = Role.parse(parseRoleFile(readFileSync(file, 'utf8')));
    expect(role.id).toBe(basename(file, '.md'));
  });

  it.each(roleFiles)('%s names only built-in tools', (file) => {
    const role = Role.parse(parseRoleFile(readFileSync(file, 'utf8')));
    expect(role.tools.filter((tool) => !BUILT_IN_TOOLS.includes(tool))).toEqual([]);
  });

  // The companion hands work to experts rather than consulting other pets.
  it.each(roleFiles.filter((file) => basename(file, '.md') !== 'companion'))(
    '%s gives its pet remember and ask_pet',
    (file) => {
      const role = Role.parse(parseRoleFile(readFileSync(file, 'utf8')));
      expect(role.tools).toEqual(expect.arrayContaining(['remember', 'ask_pet']));
    },
  );

  it('give the companion hand_to_expert and nothing that writes files or runs code', () => {
    const tools = getRole('companion')?.tools ?? [];
    expect(tools).toContain('hand_to_expert');
    expect(tools).not.toContain('ask_pet');
    expect(tools).not.toContain('watch_for');
  });

  it('tell the companion to leave itself out of what it sees, unless asked', () => {
    const instructions = getRole('companion')?.instructions ?? '';
    expect(instructions).toContain('Your own figure and bubble show up in screenshots.');
    expect(instructions).toContain('never mention yourself or Tagalong unless the person asks');
  });

  it('tell the companion to look for itself when nothing came with the question', () => {
    const instructions = getRole('companion')?.instructions ?? '';
    expect(instructions).toContain('nothing came with it, look before you answer');
    expect(instructions).toContain('minimized windows too');
  });

  it('tell the companion what a hidden marker means', () => {
    const instructions = getRole('companion')?.instructions ?? '';
    expect(instructions).toContain('[hidden: ...]');
    expect(instructions).toContain('never ask for it');
  });

  it('use unique ids', () => {
    const ids = loadRoles().map((role) => role.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parseRoleFile', () => {
  it('maps the YAML header to a role and keeps the body as instructions', () => {
    const source = [
      '---',
      'id: tester',
      'name: Tester',
      'version: 2',
      'summary: Breaks things on purpose.',
      'good_at: [edge cases]',
      'not_for: [shipping]',
      'tools: [remember]',
      'model:',
      '  tier: fast',
      '  needs_vision: true',
      '---',
      '',
      'You are a tester.',
      '',
    ].join('\r\n');
    expect(parseRoleFile(source)).toEqual({
      id: 'tester',
      name: 'Tester',
      version: 2,
      summary: 'Breaks things on purpose.',
      goodAt: ['edge cases'],
      notFor: ['shipping'],
      tools: ['remember'],
      model: { tier: 'fast', needsVision: true },
      instructions: 'You are a tester.',
    });
  });

  it('reads a file an editor saved with a byte-order mark', () => {
    const source = String.fromCharCode(0xfeff) + ['---', 'id: tester', '---', 'Body.'].join('\n');
    expect(parseRoleFile(source)).toMatchObject({ id: 'tester', instructions: 'Body.' });
  });

  it('throws on a file without a header', () => {
    expect(() => parseRoleFile('You are a tester.')).toThrow(/front-matter/);
  });
});

describe('library.generated.ts', () => {
  it('is up to date with the role files (run pnpm --filter @tagalong/core gen:roles)', () => {
    expect(lf(readFileSync(LIBRARY_FILE, 'utf8'))).toBe(renderLibrary(loadRoles()));
  });

  it('lives where the generator writes it', () => {
    expect(LIBRARY_FILE).toBe(fileURLToPath(new URL('./library.generated.ts', import.meta.url)));
  });

  it('holds every role file', () => {
    expect(ROLE_LIBRARY).toEqual(loadRoles());
  });
});

describe('listRoles', () => {
  it('lists every role in the library', () => {
    expect(listRoles().map((role) => role.id)).toEqual(ROLE_LIBRARY.map((role) => role.id));
  });
});

describe('getRole', () => {
  it('finds a role by id', () => {
    expect(getRole('writer')?.name).toBe('Writer');
  });

  it('answers undefined for an unknown id', () => {
    expect(getRole('astronaut')).toBeUndefined();
  });
});

describe('roleFor', () => {
  it("returns the pet's role, or the generalist for an id the library does not have", () => {
    expect(roleFor('writer').id).toBe('writer');
    expect(roleFor('astronaut').id).toBe('generalist');
  });
});
