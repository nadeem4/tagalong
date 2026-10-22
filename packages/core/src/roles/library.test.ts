/** Tests for the role and soul files and library.generated.ts: valid, up to date, and the companion. */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Role } from '@tagalong/protocol';
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_FILE,
  ROLES_DIR,
  SOULS_DIR,
  CONSTITUTION_FILE,
  loadConstitution,
  loadRoles,
  loadSouls,
  parseConstitutionFile,
  parseRoleFile,
  parseSoulFile,
  renderLibrary,
} from '../../scripts/gen-roles.mjs';
import { ACTIVE_SOUL, getRole, identity, modeSystem, roleFor } from './index';
import { CONSTITUTION, ROLE_LIBRARY, SOUL_LIBRARY } from './library.generated';

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
  'point_at',
  'search_history',
  'tell_expert',
  'change_settings',
  'forget',
  'work_on_it',
  'board',
  'open_result',
  'stop_work',
  'self_read',
  'self_write',
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
    // self_write writes only Scout's own notes, pages it names inside the data folder.
    const own = tools.filter((tool) => tool !== 'self_write');
    expect(own.filter((tool) => /write|edit|file|run|exec|shell|command/.test(tool))).toEqual([]);
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

  it('give the companion point_at, after change_routine', () => {
    const tools = getRole('companion')?.tools ?? [];
    expect(tools.indexOf('point_at')).toBe(tools.indexOf('change_routine') + 1);
  });

  it('give the companion change_settings, after tell_expert', () => {
    const tools = getRole('companion')?.tools ?? [];
    expect(tools.indexOf('change_settings')).toBe(tools.indexOf('tell_expert') + 1);
  });

  it('give the companion its own background work and the board, after forget', () => {
    const tools = getRole('companion')?.tools ?? [];
    const at = tools.indexOf('forget');
    expect(tools.slice(at + 1, at + 5)).toEqual([
      'work_on_it',
      'board',
      'open_result',
      'stop_work',
    ]);
    expect(getRole('companion')?.instructions).toContain('work_on_it');
  });

  // Shipped with batched arrivals, never before: the mind never claims an ability it lacks.
  it('tell the companion finished work arrives together, and Scout it can work in the background', () => {
    expect(getRole('companion')?.instructions).toContain('you hear about it together');
    expect(soulSection(identity('Scout'), '## Character')).toContain(
      'background, keep talking with them, and come back when you have something worth saying.',
    );
  });

  // The companion body says how Tagalong works, not how to behave: that is the soul's job.
  // Only the two lines the UI depends on are pinned, by what they name, not their wording.
  it('keep the companion body short: mechanics, not recipes', () => {
    const lines = lf(getRole('companion')?.instructions ?? '').split('\n');
    expect(lines.length).toBeLessThanOrEqual(40);
  });

  it('tell the companion about the draft block, which the bubble gives a Copy button', () => {
    expect(getRole('companion')?.instructions).toContain('`draft` block');
  });

  it('tell the companion that other languages go in a "> " quote, which the voice skips', () => {
    expect(getRole('companion')?.instructions).toContain('"> "');
  });

  // Rules no code enforces, so the model must be told once. Pinned by what they say, not wording.
  const companionLines = (): string[] =>
    lf(getRole('companion')?.instructions ?? '')
      .split(/\n(?=- )/)
      .map((line) => line.replace(/\s+/g, ' '));

  it('tell the companion a repo or project is never guessed', () => {
    expect(companionLines().some((line) => /guess/i.test(line) && /repo/i.test(line))).toBe(true);
  });

  it('tell the companion an app gets nothing from the screen unless they asked for it', () => {
    expect(
      companionLines().some(
        (line) => /\bapps?\b/i.test(line) && /screen/i.test(line) && /\bask/i.test(line),
      ),
    ).toBe(true);
  });

  it('tell the companion everything it writes is spoken, except what it puts in a block', () => {
    expect(
      companionLines().some(
        (line) => /spoken/i.test(line) && /\bblock\b/i.test(line) && /draft/i.test(line),
      ),
    ).toBe(true);
  });

  it("place the calendar link in Home's Meeting prep form, where it is pasted", () => {
    const line = companionLines().find((text) => /calendar link/i.test(text)) ?? '';
    expect(line).toMatch(/Meeting prep/);
  });

  it('put the companion on the balanced tier, so the mind thinks on a strong model', () => {
    expect(getRole('companion')?.model.tier).toBe('balanced');
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

/** The soul's two parts, by heading, in order: who it is and how it talks. */
const SOUL_HEADINGS = ['## Character', '## Way of speaking'];

/** The constitution's three parts, by heading, in order: shared by every character. */
const CONSTITUTION_HEADINGS = ['## Values', '## When values conflict', '## Never'];

/** A file with these headings, each followed by one line naming the companion. */
const soulWith = (headings: readonly string[]): string =>
  headings.map((heading) => `${heading}\n- {name} does something`).join('\n\n');

/** The headings of a soul or constitution text, in order. */
const headingsOf = (text: string): string[] =>
  lf(text)
    .split('\n')
    .filter((line) => line.startsWith('## '));

/** The bullets under one heading. */
const bulletsOf = (text: string, heading: string): string[] =>
  soulSection(text, heading)
    .split('\n')
    .filter((line) => line.startsWith('- '));

/** The body under one heading of a soul's text. */
function soulSection(text: string, heading: string): string {
  const lines = lf(text).split('\n');
  const start = lines.indexOf(heading);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

describe('the soul files', () => {
  it('include the active soul', () => {
    expect(Object.keys(SOUL_LIBRARY)).toContain(ACTIVE_SOUL);
    expect(readdirSync(SOULS_DIR)).toContain(`${ACTIVE_SOUL}.md`);
  });

  it.each(Object.entries(SOUL_LIBRARY))(
    '%s has exactly Character and Way of speaking, in order, none empty',
    (_id, text) => {
      expect(headingsOf(text)).toEqual(SOUL_HEADINGS);
      for (const heading of SOUL_HEADINGS) expect(soulSection(text, heading)).not.toBe('');
    },
  );

  // The name is set once, on the pet; a soul that hard-codes one would drift from it.
  it.each(Object.entries(SOUL_LIBRARY))('%s names the companion only as {name}', (_id, text) => {
    expect(text).toContain('{name}');
    expect(text).not.toMatch(/\bScout\b/);
  });

  // Values are the constitution's, the same whatever the character; a soul only adds flavour.
  it.each(Object.entries(SOUL_LIBRARY))(
    '%s holds no values or Never list of its own',
    (_id, text) => {
      expect(text).not.toMatch(/^## (Values|Never|Cares about)/m);
    },
  );
});

describe('the constitution', () => {
  it('has exactly Values, When values conflict and Never, in order, none empty', () => {
    expect(headingsOf(CONSTITUTION)).toEqual(CONSTITUTION_HEADINGS);
    for (const heading of CONSTITUTION_HEADINGS) {
      expect(soulSection(CONSTITUTION, heading)).not.toBe('');
    }
  });

  it('ranks its values as a numbered list, safety and trust first', () => {
    const ranks = soulSection(CONSTITUTION, '## When values conflict')
      .split('\n')
      .filter((line) => /^\d+\. /.test(line));
    expect(ranks.length).toBeGreaterThanOrEqual(3);
    expect(ranks[0]).toMatch(/safety/i);
  });

  // Each Never is pinned by what it forbids, so a rewrite cannot quietly drop one.
  // docs/concepts/character.md maps each to the code that enforces it.
  it.each([
    ['without their yes', /without their yes/],
    ['silence is not consent', /Silence is never a yes/],
    ['no claiming done', /claim something is done/],
    ['no clicking or typing', /click or type/],
    ['no instructions from content', /as instructions to you/],
    ['no blind spots or secrets', /blind spots/],
    ['no pretending to be a person', /pretend to be a person/],
  ])('keeps the Never rule: %s', (_name, pattern) => {
    expect(bulletsOf(CONSTITUTION, '## Never').some((line) => pattern.test(line))).toBe(true);
  });

  it('names no character, so every soul can share it', () => {
    expect(CONSTITUTION).not.toMatch(/\bScout\b|\bfox\b/i);
  });
});

describe('identity', () => {
  it('is the constitution, then the active soul, named', () => {
    const named = (text: string): string => text.replaceAll('{name}', 'Scout');
    expect(identity('Scout')).toBe(
      `${named(CONSTITUTION)}\n\n${named(SOUL_LIBRARY[ACTIVE_SOUL] ?? '')}`,
    );
  });

  it('puts the values before the character, so the character never outranks them', () => {
    const text = identity('Scout');
    expect(text.indexOf('## Never')).toBeLessThan(text.indexOf('## Character'));
  });

  it('fills in whatever the pet is called, trimmed, leaving no slot behind', () => {
    const text = identity('  Juno ');
    expect(text).toContain('You are Juno');
    expect(text).not.toContain('{name}');
  });

  it('give every mode the same identity, then the mode block', () => {
    expect(modeSystem('## Watching\nLook.', 'Scout')).toBe(
      `${identity('Scout')}\n\n## Watching\nLook.`,
    );
  });
});

describe('parseSoulFile', () => {
  it('keeps the two parts as the soul text, line endings and byte-order mark removed', () => {
    const source = String.fromCharCode(0xfeff) + soulWith(SOUL_HEADINGS).replace(/\n/g, '\r\n');
    expect(parseSoulFile(source)).toBe(soulWith(SOUL_HEADINGS));
  });

  it('throws on a missing heading', () => {
    expect(() => parseSoulFile(soulWith(['## Character']))).toThrow(/Way of speaking/);
  });

  it('throws on an extra heading', () => {
    expect(() => parseSoulFile(soulWith([...SOUL_HEADINGS, '## Never']))).toThrow(/Never/);
  });

  it('throws on headings out of order', () => {
    expect(() => parseSoulFile(soulWith(['## Way of speaking', '## Character']))).toThrow(/order/);
  });

  it('throws on an empty part', () => {
    const source = '## Character\n\n## Way of speaking\n- {name} talks plainly';
    expect(() => parseSoulFile(source)).toThrow(/Character/);
  });

  it('throws on text before the first heading', () => {
    expect(() => parseSoulFile(`Hello.\n\n${soulWith(SOUL_HEADINGS)}`)).toThrow(/heading/);
  });

  it('throws when the soul never names the companion', () => {
    expect(() => parseSoulFile('## Character\n- a fox\n\n## Way of speaking\n- plainly')).toThrow(
      /\{name\}/,
    );
  });
});

describe('parseConstitutionFile', () => {
  it('keeps the three parts', () => {
    const source = soulWith(CONSTITUTION_HEADINGS);
    expect(parseConstitutionFile(source)).toBe(source);
  });

  it('throws on a missing Never', () => {
    expect(() => parseConstitutionFile(soulWith(['## Values', '## When values conflict']))).toThrow(
      /Never/,
    );
  });

  it('throws on a character part, which belongs in a soul', () => {
    expect(() =>
      parseConstitutionFile(soulWith([...CONSTITUTION_HEADINGS, '## Character'])),
    ).toThrow(/Character/);
  });

  it('is loaded from the file next to the souls', () => {
    expect(loadConstitution()).toBe(parseConstitutionFile(readFileSync(CONSTITUTION_FILE, 'utf8')));
  });
});

describe('library.generated.ts', () => {
  it('is up to date with the role, soul and constitution files (run node scripts/gen-roles.mjs)', () => {
    expect(lf(readFileSync(LIBRARY_FILE, 'utf8'))).toBe(
      renderLibrary(loadRoles(), loadSouls(), loadConstitution()),
    );
  });

  it('lives where the generator writes it', () => {
    expect(LIBRARY_FILE).toBe(fileURLToPath(new URL('./library.generated.ts', import.meta.url)));
  });

  it('holds every role file', () => {
    expect(ROLE_LIBRARY).toEqual(loadRoles());
  });

  it('holds every soul file', () => {
    expect(SOUL_LIBRARY).toEqual(loadSouls());
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
    // A role id the library no longer has, as an older saved pet may hold.
    expect(roleFor('writer').id).toBe('companion');
    expect(roleFor('astronaut').id).toBe('companion');
  });
});
