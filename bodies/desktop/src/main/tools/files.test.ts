/**
 * Tests for the desktop file tools on a real temp directory with a fake folders getter:
 * traversal, symlink and junction escapes, clashes, the read cap, the Recycle Bin seam, and
 * Windows path rules (drive letters, backslashes, case).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileTools, isInside } from './files';

let root: string;
let allowed: string;
let outside: string;
let folders: string[];
const trash = vi.fn(async (_path: string) => undefined);

async function call(tool: string, input: Record<string, unknown>): Promise<string> {
  const parts = await fileTools({ folders: () => folders, trash })[tool]!(input);
  return parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tagalong-files-')));
  allowed = join(root, 'Downloads');
  outside = join(root, 'Secret');
  mkdirSync(allowed);
  mkdirSync(outside);
  writeFileSync(join(allowed, 'a.txt'), 'hello');
  writeFileSync(join(outside, 'key.txt'), 'private');
  folders = [allowed];
  trash.mockClear();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('isInside (pure path rules)', () => {
  it('accepts a child and the folder itself, refuses a sibling with the same prefix', () => {
    expect(isInside('/home/u/Downloads', '/home/u/Downloads/a.txt', false)).toBe(true);
    expect(isInside('/home/u/Downloads', '/home/u/Downloads', false)).toBe(true);
    expect(isInside('/home/u/Downloads', '/home/u/Downloads2/a.txt', false)).toBe(false);
    expect(isInside('/home/u/Downloads', '/home/u/other', false)).toBe(false);
  });

  it('on Windows compares drive letters and case-insensitively, with backslashes', () => {
    const dir = 'C:\\Users\\Me\\Downloads';
    expect(isInside(dir, 'c:\\users\\me\\downloads\\A.txt', true)).toBe(true);
    expect(isInside(dir, 'C:/Users/Me/Downloads/sub/b.txt', true)).toBe(true);
    expect(isInside(dir, 'D:\\Users\\Me\\Downloads\\a.txt', true)).toBe(false);
    expect(isInside(dir, 'C:\\Users\\Me\\Downloads2\\a.txt', true)).toBe(false);
    expect(isInside(dir, 'C:\\Users\\Me\\Downloads\\..\\Secret', true)).toBe(false);
  });

  it('on POSIX stays case-sensitive', () => {
    expect(isInside('/home/u/Downloads', '/home/u/downloads/a.txt', false)).toBe(false);
  });
});

describe('folders', () => {
  it('refuses everything in plain text when no folder is chosen', async () => {
    folders = [];
    const a = join(allowed, 'a.txt');
    const attempts: [string, Record<string, unknown>][] = [
      ['list_files', { path: allowed }],
      ['read_file', { path: a }],
      ['move_file', { from: a, to: join(allowed, 'b.txt') }],
      ['rename_file', { path: a, newName: 'b.txt' }],
      ['delete_file', { path: a }],
      ['write_file', { path: a, content: 'x' }],
    ];
    for (const [tool, input] of attempts) {
      expect(await call(tool, input)).toMatch(/no folders chosen/i);
    }
    expect(trash).not.toHaveBeenCalled();
    expect(readFileSync(a, 'utf8')).toBe('hello');
  });

  it('refuses a path outside every chosen folder', async () => {
    expect(await call('read_file', { path: join(outside, 'key.txt') })).toMatch(
      /outside the folders/i,
    );
    expect(await call('list_files', { path: outside })).toMatch(/outside the folders/i);
  });

  it('refuses .. traversal out of the folder', async () => {
    const sneaky = join(allowed, '..', 'Secret', 'key.txt');
    expect(await call('read_file', { path: sneaky })).toMatch(/outside the folders/i);
  });

  it('refuses a relative path', async () => {
    expect(await call('read_file', { path: 'a.txt' })).toMatch(/full path/i);
  });

  it('refuses a symlink or junction that leaves the folder', async () => {
    symlinkSync(outside, join(allowed, 'link'), 'junction');
    expect(await call('read_file', { path: join(allowed, 'link', 'key.txt') })).toMatch(
      /outside the folders/i,
    );
    expect(await call('list_files', { path: join(allowed, 'link') })).toMatch(
      /outside the folders/i,
    );
    expect(
      await call('write_file', { path: join(allowed, 'link', 'new.txt'), content: 'x' }),
    ).toMatch(/outside the folders/i);
    expect(existsSync(join(outside, 'new.txt'))).toBe(false);
  });

  it('allows a chosen folder that is itself reached through a link', async () => {
    const via = join(root, 'via');
    symlinkSync(allowed, via, 'junction');
    folders = [via];
    expect(await call('read_file', { path: join(via, 'a.txt') })).toContain('hello');
  });
});

describe('list_files', () => {
  it('lists folders and files with sizes', async () => {
    mkdirSync(join(allowed, 'sub'));
    const out = await call('list_files', { path: allowed });
    expect(out).toContain('sub/');
    expect(out).toMatch(/a\.txt.*5 bytes/);
  });

  it('caps a long listing and says so', async () => {
    for (let i = 0; i < 205; i++) writeFileSync(join(allowed, `f${i}.txt`), '');
    const out = await call('list_files', { path: allowed });
    const shown = out.split('\n').filter((l) => /^f\d+\.txt|^a\.txt/.test(l)).length;
    expect(shown).toBe(200);
    expect(out).toMatch(/more not shown/i);
  });
});

describe('read_file', () => {
  it('reads text', async () => {
    expect(await call('read_file', { path: join(allowed, 'a.txt') })).toContain('hello');
  });

  it('caps long text and says it was cut', async () => {
    writeFileSync(join(allowed, 'big.txt'), 'x'.repeat(50_000));
    const out = await call('read_file', { path: join(allowed, 'big.txt'), maxChars: 100 });
    expect(out).toMatch(/cut at 100/i);
    expect(out.length).toBeLessThan(400);
  });

  it('gives a notice instead of binary bytes', async () => {
    writeFileSync(join(allowed, 'pic.bin'), Buffer.from([0x89, 0x50, 0, 0, 1, 2, 3]));
    const out = await call('read_file', { path: join(allowed, 'pic.bin') });
    expect(out).toMatch(/binary/i);
    expect(out).toContain('7 bytes');
  });
});

describe('move_file and rename_file', () => {
  it('moves a file inside the folder', async () => {
    mkdirSync(join(allowed, 'sub'));
    await call('move_file', { from: join(allowed, 'a.txt'), to: join(allowed, 'sub', 'a.txt') });
    expect(existsSync(join(allowed, 'sub', 'a.txt'))).toBe(true);
    expect(existsSync(join(allowed, 'a.txt'))).toBe(false);
  });

  it('moves into a folder when the target is an existing directory', async () => {
    mkdirSync(join(allowed, 'sub'));
    await call('move_file', { from: join(allowed, 'a.txt'), to: join(allowed, 'sub') });
    expect(existsSync(join(allowed, 'sub', 'a.txt'))).toBe(true);
  });

  it('refuses a clash and leaves both files alone', async () => {
    writeFileSync(join(allowed, 'b.txt'), 'other');
    const out = await call('move_file', {
      from: join(allowed, 'a.txt'),
      to: join(allowed, 'b.txt'),
    });
    expect(out).toMatch(/already exists/i);
    expect(readFileSync(join(allowed, 'b.txt'), 'utf8')).toBe('other');
    expect(existsSync(join(allowed, 'a.txt'))).toBe(true);
  });

  it('refuses to move out of, or in from, outside the folders', async () => {
    expect(
      await call('move_file', { from: join(allowed, 'a.txt'), to: join(outside, 'a.txt') }),
    ).toMatch(/outside the folders/i);
    expect(
      await call('move_file', { from: join(outside, 'key.txt'), to: join(allowed, 'key.txt') }),
    ).toMatch(/outside the folders/i);
    expect(existsSync(join(outside, 'key.txt'))).toBe(true);
  });

  it('renames in place and refuses a clash', async () => {
    writeFileSync(join(allowed, 'b.txt'), 'other');
    expect(await call('rename_file', { path: join(allowed, 'a.txt'), newName: 'b.txt' })).toMatch(
      /already exists/i,
    );
    await call('rename_file', { path: join(allowed, 'a.txt'), newName: 'c.txt' });
    expect(existsSync(join(allowed, 'c.txt'))).toBe(true);
  });

  it('refuses a new name that is a path', async () => {
    for (const newName of ['..\\x.txt', '../x.txt', 'sub/x.txt', '..', '']) {
      expect(await call('rename_file', { path: join(allowed, 'a.txt'), newName })).toMatch(
        /just a name/i,
      );
    }
    expect(existsSync(join(allowed, 'a.txt'))).toBe(true);
  });
});

describe('delete_file', () => {
  it('sends the file to the Recycle Bin through the seam, never removes it itself', async () => {
    const out = await call('delete_file', { path: join(allowed, 'a.txt') });
    expect(trash).toHaveBeenCalledWith(join(allowed, 'a.txt'));
    expect(out).toMatch(/recycle bin/i);
    expect(existsSync(join(allowed, 'a.txt'))).toBe(true);
  });

  it('refuses outside the folders and refuses the chosen folder itself', async () => {
    expect(await call('delete_file', { path: join(outside, 'key.txt') })).toMatch(/outside/i);
    expect(await call('delete_file', { path: allowed })).toMatch(/chosen folder itself/i);
    expect(trash).not.toHaveBeenCalled();
  });
});

describe('write_file', () => {
  it('overwrites an existing file and creates a new one', async () => {
    await call('write_file', { path: join(allowed, 'a.txt'), content: 'new' });
    expect(readFileSync(join(allowed, 'a.txt'), 'utf8')).toBe('new');
    await call('write_file', { path: join(allowed, 'n.txt'), content: 'fresh' });
    expect(readFileSync(join(allowed, 'n.txt'), 'utf8')).toBe('fresh');
  });

  it('refuses outside the folders, a folder target and a missing parent', async () => {
    expect(await call('write_file', { path: join(outside, 'x.txt'), content: 'x' })).toMatch(
      /outside/i,
    );
    expect(await call('write_file', { path: allowed, content: 'x' })).toMatch(/folder/i);
    expect(
      await call('write_file', { path: join(allowed, 'nope', 'x.txt'), content: 'x' }),
    ).toMatch(/does not exist/i);
  });
});
