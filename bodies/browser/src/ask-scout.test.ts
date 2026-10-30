/**
 * Tests for turning a right-click or an address-bar entry into something to say to Scout. The
 * page's address loses its query and fragment, the same as the tab fact, because tokens live there.
 */
import { describe, expect, it } from 'vitest';
import { fromMenuClick, fromOmnibox, MENU_ID, MENU_TITLE } from './ask-scout';

const TAB = { title: 'Docs', url: 'https://a.test/docs?token=1#top' };

describe('fromMenuClick', () => {
  it('uses_the_selection_and_the_page_as_context', () => {
    expect(fromMenuClick({ selectionText: 'what is a monad' }, TAB)).toEqual({
      text: 'what is a monad',
      context: { url: 'https://a.test/docs', title: 'Docs' },
    });
  });

  it('with_no_selection_is_null', () => {
    expect(fromMenuClick({}, TAB)).toBeNull();
    expect(fromMenuClick({ selectionText: '   ' }, TAB)).toBeNull();
  });

  it('strips_the_query_from_the_context_url', () => {
    const ask = fromMenuClick({ selectionText: 'x', pageUrl: 'https://b.test/p?q=1' }, undefined);
    expect(ask?.context.url).toBe('https://b.test/p');
  });

  it('names_the_menu_item', () => {
    expect(MENU_ID).toBe('ask-scout');
    expect(MENU_TITLE).toBe('Ask Scout about this');
  });
});

describe('fromOmnibox', () => {
  it('uses_the_typed_text', () => {
    expect(fromOmnibox('  summarize this ', TAB)).toEqual({
      text: 'summarize this',
      context: { url: 'https://a.test/docs', title: 'Docs' },
    });
  });

  it('blank_is_null', () => {
    expect(fromOmnibox('', TAB)).toBeNull();
    expect(fromOmnibox('  \t', TAB)).toBeNull();
  });
});
