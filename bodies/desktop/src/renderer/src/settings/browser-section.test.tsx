/**
 * Tests for the "Add Scout to your browser" section. No DOM in this suite: the markup is
 * rendered statically and the buttons' handlers are found in the element tree and called.
 */
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSection } from './browser-section';

const FOLDER = { path: '/Tagalong/resources/extension', exists: true };

/** Every element in the tree under `node`, children and nested props alike. */
function walk(node: ReactNode, found: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((child) => walk(child as ReactNode, found));
  else if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    found.push(element as ReactElement<Record<string, unknown>>);
    walk(element.props.children, found);
  }
  return found;
}

function click(folder: { path: string; exists: boolean } | null, label: string): void {
  const buttons = walk(BrowserSection({ folder })).filter((el) => el.type === 'button');
  const button = buttons.find((el) => el.props['children'] === label);
  if (button === undefined) throw new Error(`no button "${label}"`);
  (button.props['onClick'] as () => void)();
}

afterEach(() => vi.unstubAllGlobals());

describe('BrowserSection', () => {
  it('shows_the_three_steps', () => {
    const html = renderToStaticMarkup(<BrowserSection folder={FOLDER} />);
    expect(html).toContain('chrome://extensions');
    expect(html).toContain('edge://extensions');
    expect(html).toContain('Developer mode');
    expect(html).toContain('Load unpacked');
    expect((html.match(/<li/g) ?? []).length).toBe(3);
  });

  it('copy_buttons_write_the_folder_path_and_both_addresses', () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    click(FOLDER, 'Copy folder path');
    click(FOLDER, 'Copy chrome://extensions');
    click(FOLDER, 'Copy edge://extensions');
    expect(writeText.mock.calls).toEqual([
      [FOLDER.path],
      ['chrome://extensions'],
      ['edge://extensions'],
    ]);
  });

  it('show_folder_calls_the_bridge', () => {
    const showBrowserFolder = vi.fn(() => Promise.resolve());
    vi.stubGlobal('window', { tagalongHost: { showBrowserFolder } });
    click(FOLDER, 'Show folder');
    expect(showBrowserFolder).toHaveBeenCalledTimes(1);
  });

  it('says_how_to_build_when_the_folder_is_missing', () => {
    const html = renderToStaticMarkup(
      <BrowserSection folder={{ path: '/x/dist', exists: false }} />,
    );
    expect(html).toContain('Build it first: pnpm --filter @tagalong/browser build');
    expect(html).not.toContain('Show folder');
  });

  it('never_mentions_a_pairing_token', () => {
    for (const folder of [FOLDER, { path: '/x', exists: false }, null]) {
      expect(renderToStaticMarkup(<BrowserSection folder={folder} />).toLowerCase()).not.toMatch(
        /token|pairing/,
      );
    }
  });
});
