/** Tests for dropping a file, image, link or text on Scout: the offer, the read and the hold. */

import { describe, expect, it } from 'vitest';
import type { CapturedImage } from '@tagalong/protocol';
import { MAX_SELECTION_CHARS } from '@tagalong/protocol';
import { fakeIpc } from './ipc/fake-ipc';
import { IPC } from '../shared/ipc';
import {
  DROP_HOLD_MS,
  MAX_IMAGE_FILE_BYTES,
  MAX_TEXT_FILE_BYTES,
  SECRET_REFUSAL,
  dropDesk,
  guardNavigation,
  offerFor,
  readDrop,
  registerDropIpc,
} from './drop';
import type { DropFs } from './drop';

const PNG: CapturedImage = { mime: 'image/png', base64: 'cG5n', width: 4, height: 2 };

/** A disk of named files: their sizes and texts. A path it does not hold is missing. */
function fakeFs(files: Record<string, { size: number; text?: string }>) {
  const reads: string[] = [];
  const fs: DropFs = {
    size: (path) => {
      const file = files[path];
      return file === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(file.size);
    },
    readText: (path) => {
      reads.push(path);
      return Promise.resolve(files[path]?.text ?? '');
    },
    readImage: (path, maxLongSide) => {
      reads.push(`${path}@${maxLongSide}`);
      return Promise.resolve(PNG);
    },
  };
  return { fs, reads };
}

describe('offerFor', () => {
  it('caps dropped text and a link', () => {
    const long = 'x'.repeat(MAX_SELECTION_CHARS + 50);
    const text = offerFor({ paths: [], text: long });
    expect(text).toEqual({
      dropped: { kind: 'text', text: long.slice(0, MAX_SELECTION_CHARS) },
      explain: true,
    });

    const url = `https://example.com/${'a'.repeat(MAX_SELECTION_CHARS)}`;
    const link = offerFor({ paths: [], uri: `# comment\r\n${url}`, text: url });
    expect(link).toMatchObject({ dropped: { kind: 'link' }, explain: false });
    expect(link !== null && 'dropped' in link && link.dropped.text?.length).toBe(
      MAX_SELECTION_CHARS,
    );
  });

  it('names a file by its last part, on either kind of path, and reads nothing yet', () => {
    expect(offerFor({ paths: ['C:\\work\\report.md'] })).toEqual({
      dropped: { kind: 'file', name: 'report.md', path: 'C:\\work\\report.md' },
      explain: true,
    });
    // A PDF or a Word file is hand-off only: Tagalong does not read them.
    expect(offerFor({ paths: ['/w/a.pdf'] })).toEqual({
      dropped: { kind: 'file', name: 'a.pdf', path: '/w/a.pdf' },
      explain: false,
    });
    expect(offerFor({ paths: ['/home/a/chart.PNG'] })).toEqual({
      dropped: { kind: 'image', name: 'chart.PNG', path: '/home/a/chart.PNG' },
      explain: true,
    });
  });

  it('prefers the file over the link and text a drag carries beside it', () => {
    expect(
      offerFor({ paths: ['/a/b.txt'], uri: 'https://x.test/', text: 'https://x.test/' }),
    ).toMatchObject({ dropped: { kind: 'file', path: '/a/b.txt' } });
  });

  it('words the secrets refusal neutrally, not in Scout’s voice', () => {
    expect(SECRET_REFUSAL).toBe('Looks like a secrets file: not read, not passed on.');
  });

  it('refuses a secrets file without reading it', () => {
    for (const path of ['/repo/.env', 'C:\\Users\\a\\.ssh\\id_rsa', '/repo/secrets.json']) {
      expect(offerFor({ paths: [path] })).toEqual({ refusal: SECRET_REFUSAL });
    }
  });

  it('refuses secrets files by any case, nested anywhere, by pattern too', () => {
    for (const path of [
      'C:\\Users\\A\\.SSH\\ID_RSA',
      'C:\\deep\\nested\\dir\\.ENV',
      '/srv/app/config/.env.production',
      'D:\\certs\\Server.PEM',
      '/home/a/keys/deploy.key',
      'C:\\w\\Secrets.Yaml',
    ]) {
      expect(offerFor({ paths: [path] })).toEqual({ refusal: SECRET_REFUSAL });
    }
    // A name that only contains a secret word is an ordinary file.
    expect(offerFor({ paths: ['/w/env-notes.md'] })).toMatchObject({ explain: true });
  });

  it('treats a non-web link as text, and gives nothing for an empty or malformed drop', () => {
    expect(offerFor({ paths: [], uri: 'file:///c/x', text: 'file:///c/x' })).toEqual({
      dropped: { kind: 'text', text: 'file:///c/x' },
      explain: true,
    });
    expect(offerFor({ paths: [], text: '   ' })).toBeNull();
    expect(offerFor({ paths: ['relative/a.md'] })).toBeNull();
    expect(offerFor(null)).toBeNull();
    expect(offerFor({ paths: 'nope' })).toBeNull();
  });
});

describe('readDrop', () => {
  it('reads a .md file, capped like a selection', async () => {
    const long = '#'.repeat(MAX_SELECTION_CHARS + 5);
    const { fs } = fakeFs({ '/w/report.md': { size: 900, text: long } });
    const read = await readDrop({ kind: 'file', name: 'report.md', path: '/w/report.md' }, fs);
    expect(read).toEqual({
      ok: true,
      dropped: {
        kind: 'file',
        name: 'report.md',
        path: '/w/report.md',
        size: 900,
        text: long.slice(0, MAX_SELECTION_CHARS),
      },
    });
  });

  it('reports an oversized text file by name and size only', async () => {
    const { fs, reads } = fakeFs({ '/w/big.log': { size: MAX_TEXT_FILE_BYTES + 1 } });
    const read = await readDrop({ kind: 'file', name: 'big.log', path: '/w/big.log' }, fs);
    expect(read).toEqual({
      ok: true,
      dropped: { kind: 'file', name: 'big.log', path: '/w/big.log', size: MAX_TEXT_FILE_BYTES + 1 },
    });
    expect(reads).toEqual([]);
  });

  it('turns an image into a PNG at the capture long side', async () => {
    const { fs, reads } = fakeFs({ '/w/chart.jpg': { size: 5000 } });
    const read = await readDrop({ kind: 'image', name: 'chart.jpg', path: '/w/chart.jpg' }, fs);
    expect(read).toEqual({
      ok: true,
      dropped: { kind: 'image', name: 'chart.jpg', path: '/w/chart.jpg', size: 5000, image: PNG },
    });
    expect(reads).toEqual(['/w/chart.jpg@1568']);
  });

  it('reports an oversized image as a file, unread', async () => {
    const { fs, reads } = fakeFs({ '/w/huge.png': { size: MAX_IMAGE_FILE_BYTES + 1 } });
    const read = await readDrop({ kind: 'image', name: 'huge.png', path: '/w/huge.png' }, fs);
    expect(read).toMatchObject({ ok: true, dropped: { kind: 'file', name: 'huge.png' } });
    expect(reads).toEqual([]);
  });

  it('reports a pdf by its path only', async () => {
    const { fs, reads } = fakeFs({ '/w/a.pdf': { size: 2048 } });
    const read = await readDrop({ kind: 'file', name: 'a.pdf', path: '/w/a.pdf' }, fs);
    expect(read).toEqual({
      ok: true,
      dropped: { kind: 'file', name: 'a.pdf', path: '/w/a.pdf', size: 2048 },
    });
    expect(reads).toEqual([]);
  });

  it('refuses a secrets file again, should one reach it', async () => {
    const { fs, reads } = fakeFs({ '/r/.env': { size: 10, text: 'KEY=1' } });
    expect(await readDrop({ kind: 'file', name: '.env', path: '/r/.env' }, fs)).toEqual({
      ok: false,
      error: SECRET_REFUSAL,
    });
    expect(reads).toEqual([]);
  });

  it('judges a secrets file by its path, whatever name it arrives with', async () => {
    const { fs, reads } = fakeFs({ '/r/.env': { size: 10, text: 'KEY=1' } });
    expect(await readDrop({ kind: 'file', name: 'report.md', path: '/r/.env' }, fs)).toEqual({
      ok: false,
      error: SECRET_REFUSAL,
    });
    expect(reads).toEqual([]);
  });

  it('returns an error for a missing file rather than throwing', async () => {
    const { fs } = fakeFs({});
    const read = await readDrop({ kind: 'file', name: 'gone.md', path: '/w/gone.md' }, fs);
    expect(read).toEqual({ ok: false, error: 'Couldn’t read gone.md.' });
  });

  it('returns an error when a picture cannot be decoded', async () => {
    const { fs } = fakeFs({ '/w/bad.png': { size: 10 } });
    fs.readImage = () => Promise.reject(new Error('not an image'));
    const read = await readDrop({ kind: 'image', name: 'bad.png', path: '/w/bad.png' }, fs);
    expect(read).toEqual({ ok: false, error: 'Couldn’t read bad.png.' });
  });

  it('passes text and a link through as they are', async () => {
    const { fs } = fakeFs({});
    expect(await readDrop({ kind: 'text', text: 'hi' }, fs)).toEqual({
      ok: true,
      dropped: { kind: 'text', text: 'hi' },
    });
  });
});

describe('dropDesk', () => {
  it('holds the offered item and reads it only when taken, once', async () => {
    const { fs, reads } = fakeFs({ '/w/a.md': { size: 3, text: 'abc' } });
    const desk = dropDesk(fs);
    expect(desk.offer({ paths: ['/w/a.md'] })).toMatchObject({ dropped: { kind: 'file' } });
    expect(reads).toEqual([]);

    expect(await desk.take()).toMatchObject({ kind: 'file', text: 'abc' });
    expect(reads).toEqual(['/w/a.md']);
    await expect(desk.take()).rejects.toThrow(/nothing/i);
  });

  it('holds nothing after a refusal, and throws the read error on take', async () => {
    const { fs } = fakeFs({});
    const desk = dropDesk(fs);
    desk.offer({ paths: ['/w/a.md'] });
    desk.offer({ paths: ['/r/.env'] });
    await expect(desk.take()).rejects.toThrow(/nothing/i);

    desk.offer({ paths: ['/w/gone.md'] });
    await expect(desk.take()).rejects.toThrow('Couldn’t read gone.md.');
  });

  it('lets a held drop expire, unread, so a later ask cannot send it', async () => {
    const { fs, reads } = fakeFs({ '/w/a.md': { size: 3, text: 'abc' } });
    let now = 1_000;
    const desk = dropDesk(fs, () => now);
    desk.offer({ paths: ['/w/a.md'] });
    now += DROP_HOLD_MS + 1;
    await expect(desk.take()).rejects.toThrow(/drop it on me again/i);
    expect(reads).toEqual([]);
    // Expired is gone, not waiting: a second try finds nothing either.
    await expect(desk.take()).rejects.toThrow(/nothing/i);
  });

  it('still sends a drop taken within the hold', async () => {
    const { fs } = fakeFs({ '/w/a.md': { size: 3, text: 'abc' } });
    let now = 1_000;
    const desk = dropDesk(fs, () => now);
    desk.offer({ paths: ['/w/a.md'] });
    now += DROP_HOLD_MS - 1;
    expect(await desk.take()).toMatchObject({ text: 'abc' });
  });
});

describe('registerDropIpc', () => {
  const avatarEvent = { sender: 'avatar' };
  function setup() {
    const ipc = fakeIpc();
    const { fs } = fakeFs({ '/w/a.md': { size: 3, text: 'abc' } });
    const desk = dropDesk(fs);
    const shown: unknown[] = [];
    registerDropIpc(ipc.handle, {
      desk,
      fromAvatar: (event) => event === avatarEvent,
      show: (offer) => shown.push(offer),
    });
    return { ipc, desk, shown };
  }

  it('opens the card for a drop on the figure', async () => {
    const { ipc, shown } = setup();
    await ipc.invokeWith(avatarEvent, IPC.dropOnPet, { paths: ['/w/a.md'] });
    expect(shown).toEqual([
      { dropped: { kind: 'file', name: 'a.md', path: '/w/a.md' }, explain: true },
    ]);
  });

  it('takes a drop only from the figure’s own window, holding nothing from elsewhere', async () => {
    const { ipc, desk, shown } = setup();
    await expect(ipc.invoke(IPC.dropOnPet, { paths: ['/w/a.md'] })).rejects.toThrow(/figure/i);
    expect(shown).toEqual([]);
    await expect(desk.take()).rejects.toThrow(/nothing/i);
  });

  it('shows nothing for an empty drop', async () => {
    const { ipc, shown } = setup();
    await ipc.invokeWith(avatarEvent, IPC.dropOnPet, { paths: [] });
    expect(shown).toEqual([]);
  });
});

describe('guardNavigation', () => {
  it('stops the window navigating to a dropped file', () => {
    const listeners = new Map<string, (event: { preventDefault: () => void }) => void>();
    guardNavigation({ on: (name, listener) => void listeners.set(name, listener) });
    let prevented = false;
    listeners.get('will-navigate')?.({ preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
  });
});
