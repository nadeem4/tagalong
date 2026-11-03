/**
 * The desktop's file tools: list, read, move, rename, delete and overwrite, only inside the
 * folders the person chose. File access, not computer control. Every path is resolved and then
 * realpath'd, so `..`, symlinks and junctions cannot walk out. Refusals come back as plain
 * text for Scout to relay; delete goes to the Recycle Bin through an injected seam.
 */
import { open, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Part } from '@tagalong/contract';

export type FileDeps = {
  /** The folders the person allowed; empty means every file tool refuses. */
  folders: () => string[];
  /** Sends a path to the Recycle Bin (`shell.trashItem` in the app). */
  trash: (path: string) => Promise<void>;
};

type Handler = (input: Record<string, unknown>) => Promise<Part[]>;

const DEFAULT_READ_CHARS = 20_000;
const MAX_LISTED = 200;
const BINARY_SNIFF_BYTES = 8_000;

const NO_FOLDERS =
  'No folders chosen yet: the person has not allowed Scout into any folder, so it cannot touch files.';
const OUTSIDE = 'That path is outside the folders the person chose, so Scout cannot touch it.';

/** A refusal: thrown inside a handler and turned into a plain text result by `guard`. */
class Refusal extends Error {}

/** Whether `target` is `folder` or below it. Windows ignores case and accepts / or \ . */
export function isInside(folder: string, target: string, windows: boolean): boolean {
  const p = windows ? path.win32 : path.posix;
  const fold = (s: string) => (windows ? s.toLowerCase() : s);
  const rel = p.relative(fold(p.resolve(folder)), fold(p.resolve(target)));
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}

/** realpath of a path that may not exist yet: the nearest existing parent, resolved, plus the rest. */
async function realish(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(await realish(parent), path.basename(p));
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function text(value: string): Part[] {
  return [{ type: 'text', text: value }];
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) throw new Refusal(`${key} is required.`);
  return value;
}

export function fileTools(deps: FileDeps): Record<string, Handler> {
  const windows = process.platform === 'win32';

  /** The real path of `raw`, or a Refusal when no folder is chosen or it leaves them. */
  async function allow(raw: string): Promise<{ real: string; roots: string[] }> {
    const chosen = deps.folders();
    if (chosen.length === 0) throw new Refusal(NO_FOLDERS);
    if (!path.isAbsolute(raw)) {
      throw new Refusal('Give the full path (for example C:\\Users\\name\\Downloads\\file.txt).');
    }
    const roots: string[] = [];
    for (const folder of chosen) {
      try {
        roots.push(await realpath(path.resolve(folder)));
      } catch {
        // A chosen folder that no longer exists grants nothing.
      }
    }
    const real = await realish(path.resolve(raw));
    if (!roots.some((root) => isInside(root, real, windows))) throw new Refusal(OUTSIDE);
    return { real, roots };
  }

  const guard =
    (run: Handler): Handler =>
    async (input) => {
      try {
        return await run(input);
      } catch (error) {
        if (error instanceof Refusal) return text(error.message);
        throw error;
      }
    };

  async function listFiles(input: Record<string, unknown>): Promise<Part[]> {
    const { real } = await allow(str(input, 'path'));
    const entries = (await readdir(real, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const lines: string[] = [];
    for (const entry of entries.slice(0, MAX_LISTED)) {
      if (entry.isDirectory()) lines.push(`${entry.name}/`);
      else {
        const { size } = await stat(path.join(real, entry.name)).catch(() => ({ size: 0 }));
        lines.push(`${entry.name}  ${size} bytes`);
      }
    }
    if (entries.length > MAX_LISTED) {
      lines.push(`(${entries.length - MAX_LISTED} more not shown)`);
    }
    return text(lines.length > 0 ? lines.join('\n') : 'The folder is empty.');
  }

  async function readFile(input: Record<string, unknown>): Promise<Part[]> {
    const { real } = await allow(str(input, 'path'));
    const asked = input['maxChars'];
    const cap =
      typeof asked === 'number' && Number.isFinite(asked) && asked > 0
        ? Math.floor(asked)
        : DEFAULT_READ_CHARS;
    const { size } = await stat(real);
    // Read only what can matter: 4 bytes per character covers UTF-8, plus one to see the cut.
    const handle = await open(real, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(size, cap * 4 + 4));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        return text(`${path.basename(real)} is a binary file (${size} bytes), so it was not read.`);
      }
      const content = bytes.toString('utf8');
      const cut = content.length > cap || size > bytesRead;
      return text(cut ? `${content.slice(0, cap)}\n[cut at ${cap} characters]` : content);
    } finally {
      await handle.close();
    }
  }

  async function moveTo(from: string, to: string): Promise<Part[]> {
    const source = (await allow(from)).real;
    let target = (await allow(to)).real;
    // An existing folder as the target means "into it".
    if (
      await stat(target).then(
        (s) => s.isDirectory(),
        () => false,
      )
    ) {
      target = path.join(target, path.basename(source));
      await allow(target);
    }
    if (!(await exists(source))) throw new Refusal('That file does not exist.');
    // Never overwrite: a clash is a refusal, not a choice made for the person.
    if (await exists(target)) {
      throw new Refusal(`${path.basename(target)} already exists there, so nothing was moved.`);
    }
    await rename(source, target);
    return text(`Moved to ${target}`);
  }

  async function moveFile(input: Record<string, unknown>): Promise<Part[]> {
    return moveTo(str(input, 'from'), str(input, 'to'));
  }

  async function renameFile(input: Record<string, unknown>): Promise<Part[]> {
    const from = str(input, 'path');
    const newName = typeof input['newName'] === 'string' ? input['newName'] : '';
    if (newName === '' || newName === '..' || newName === '.' || /[\\/]/.test(newName)) {
      throw new Refusal('newName must be just a name, not a path. Use move_file to change folder.');
    }
    return moveTo(from, path.join(path.dirname(from), newName));
  }

  async function deleteFile(input: Record<string, unknown>): Promise<Part[]> {
    const { real, roots } = await allow(str(input, 'path'));
    if (roots.some((root) => isInside(root, real, windows) && isInside(real, root, windows))) {
      throw new Refusal('That is a chosen folder itself; Scout will not delete it.');
    }
    if (!(await exists(real))) throw new Refusal('That file does not exist.');
    await deps.trash(real);
    return text('Moved to the Recycle Bin.');
  }

  async function writeTo(input: Record<string, unknown>): Promise<Part[]> {
    const { real } = await allow(str(input, 'path'));
    const content = input['content'];
    if (typeof content !== 'string') throw new Refusal('content is required.');
    if (
      await stat(real).then(
        (s) => s.isDirectory(),
        () => false,
      )
    ) {
      throw new Refusal('That path is a folder, not a file.');
    }
    if (!(await exists(path.dirname(real)))) {
      throw new Refusal('The folder for that file does not exist.');
    }
    await writeFile(real, content, 'utf8');
    return text(`Wrote ${content.length} characters to ${real}`);
  }

  return {
    list_files: guard(listFiles),
    read_file: guard(readFile),
    move_file: guard(moveFile),
    rename_file: guard(renameFile),
    delete_file: guard(deleteFile),
    write_file: guard(writeTo),
  };
}
