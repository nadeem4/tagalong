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
import { getRole, roleFor } from './index';
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
  'look_at_window',
  'recall_screen',
  'what_changed',
  'watch_for',
  'remember',
  'create_routine',
  'change_routine',
  'hand_to_expert',
  // A group: every tool of the person's connected apps.
  'connections',
];

const roleFiles = readdirSync(ROLES_DIR)
  .filter((file) => file.endsWith('.md'))
  .map((file) => join(ROLES_DIR, file));

const lf = (text: string): string => text.replace(/\r\n/g, '\n');

describe('the role files', () => {
  it('include the one shipped role: the companion', () => {
    expect(roleFiles.map((file) => basename(file, '.md'))).toEqual(['companion']);
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

  it('give the companion hand_to_expert and nothing that writes files or runs code', () => {
    const tools = getRole('companion')?.tools ?? [];
    expect(tools).toContain('hand_to_expert');
    expect(tools.filter((tool) => /write|edit|file|run|exec|shell|command/.test(tool))).toEqual([]);
  });

  it('give the companion the watch and screen-memory tools', () => {
    const tools = getRole('companion')?.tools ?? [];
    for (const tool of [
      'watch_for',
      'recall_screen',
      'what_changed',
      'look_closer',
      'list_displays',
      'look_at_display',
    ]) {
      expect(tools).toContain(tool);
    }
  });

  it('tell the companion when to watch, recall, zoom and look at another screen', () => {
    const instructions = getRole('companion')?.instructions ?? '';
    expect(instructions).toContain('watch_for');
    expect(instructions).toContain('stops on its own');
    expect(instructions).toContain('recall_screen');
    expect(instructions).toContain('what_changed');
    expect(instructions).toContain('look_closer');
    expect(instructions).toContain('list_displays');
    expect(instructions).toContain('look_at_display');
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

  it('tell the companion to answer "what do you see" from the window list, per screen', () => {
    const instructions = getRole('companion')?.instructions ?? '';
    expect(instructions).toContain('What do you see?');
    expect(instructions).toContain('from list_windows alone');
    expect(instructions).toContain('no screenshot and no read_window_text');
    expect(instructions).toContain('per screen');
    expect(instructions).toContain('then what is minimized');
  });

  it('tell the companion to read one window in detail only when asked about it', () => {
    const instructions = getRole('companion')?.instructions ?? '';
    expect(instructions).toContain('read_window_text that window');
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

describe('getRole', () => {
  it('finds a role by id', () => {
    expect(getRole('companion')?.name).toBe('Companion');
  });

  it('answers undefined for an unknown id', () => {
    expect(getRole('astronaut')).toBeUndefined();
  });
});

describe('roleFor', () => {
  it("returns the pet's role, or the companion for an id the library does not have", () => {
    expect(roleFor('companion').id).toBe('companion');
    // A crew-era role, still on a pet saved before the crew went.
    expect(roleFor('writer').id).toBe('companion');
    expect(roleFor('astronaut').id).toBe('companion');
  });
});
