/**
 * Tests for the "Files Scout may use" section. Static render (no DOM in this suite): the
 * markup is checked and the buttons' handlers are found in the element tree and called.
 */
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FilesSection } from './files-section';

function walk(node: ReactNode, found: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((child) => walk(child as ReactNode, found));
  else if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    found.push(element as ReactElement<Record<string, unknown>>);
    walk(element.props.children, found);
  }
  return found;
}

const noop = () => undefined;

describe('FilesSection', () => {
  it('says no folder is allowed yet when the list is empty', () => {
    const html = renderToStaticMarkup(<FilesSection folders={[]} onAdd={noop} onRemove={noop} />);
    expect(html).toContain('No folders yet');
    expect(html).toContain('Add folder');
  });

  it('lists each folder with a Remove button named for it', () => {
    const html = renderToStaticMarkup(
      <FilesSection folders={['C:\\Users\\me\\Downloads']} onAdd={noop} onRemove={noop} />,
    );
    expect(html).toContain('C:\\Users\\me\\Downloads');
    expect(html).toContain('aria-label="Remove C:\\Users\\me\\Downloads"');
    expect(html).not.toContain('No folders yet');
  });

  it('Add folder and Remove call back', () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    vi.stubGlobal('document', { getElementById: () => null });
    const tree = walk(FilesSection({ folders: ['/a', '/b'], onAdd, onRemove }));
    const buttons = tree.filter((el) => el.props['onClick'] !== undefined);
    const add = buttons.find((el) => el.props['children'] === 'Add folder')!;
    (add.props['onClick'] as () => void)();
    const remove = buttons.find((el) => el.props['aria-label'] === 'Remove /b')!;
    (remove.props['onClick'] as () => void)();
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith('/b');
  });

  it('moves focus to Add folder after a Remove', () => {
    const focus = vi.fn();
    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'files-add' ? { focus } : null),
    });
    const tree = walk(FilesSection({ folders: ['/a'], onAdd: noop, onRemove: noop }));
    const remove = tree.find((el) => el.props['aria-label'] === 'Remove /a')!;
    (remove.props['onClick'] as () => void)();
    vi.unstubAllGlobals();
    expect(focus).toHaveBeenCalledOnce();
    expect(
      renderToStaticMarkup(<FilesSection folders={[]} onAdd={noop} onRemove={noop} />),
    ).toContain('id="files-add"');
  });

  it('says what it does: delete goes to the Recycle Bin and removing takes access away', () => {
    const html = renderToStaticMarkup(<FilesSection folders={[]} onAdd={noop} onRemove={noop} />);
    expect(html).toContain('Recycle Bin');
    expect(html).toMatch(/no folder|none by default/i);
  });
});
