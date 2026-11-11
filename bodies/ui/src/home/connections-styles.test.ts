/** Tests for CONNECTIONS_CSS: the row grid, chips, check card, and only the type sizes and weights the type roles define. */

import { describe, expect, it } from 'vitest';
import { themeTokens as t, typeCss } from '../theme/tokens';
import { CONNECTIONS_CSS } from './connections-styles';

describe('CONNECTIONS_CSS', () => {
  it('serves the tour as well as Home, with a warning status for Offline and Needs sign-in', () => {
    expect(CONNECTIONS_CSS).toMatch(/:is\(\.home, \.wt\) \.cx-row \{/);
    expect(CONNECTIONS_CSS).toMatch(new RegExp(`\\.cx-status--warn \\{[^}]*${t.color.warnInk}`));
  });

  it('lays a row out as a 36px tile, the text and the actions', () => {
    expect(CONNECTIONS_CSS).toMatch(/\.cx-row \{[^}]*grid-template-columns: 36px 1fr auto/);
  });

  it('draws the Official chip from the ok tokens', () => {
    expect(CONNECTIONS_CSS).toMatch(
      new RegExp(`\\.cx-chip--official \\{[^}]*${t.color.okFill}[^}]*${t.color.okInk}`),
    );
  });

  it('draws the check card on the warning fill', () => {
    expect(CONNECTIONS_CSS).toMatch(new RegExp(`\\.cx-check \\{[^}]*${t.color.warnFill}`));
  });

  it('dims the old results while a search runs', () => {
    expect(CONNECTIONS_CSS).toMatch(/\.cx-stale \{[^}]*opacity: \.45/);
  });

  it('stops the spinner for reduced motion', () => {
    expect(CONNECTIONS_CSS).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{[^}]*\.cx-spin[^}]*animation: none/,
    );
  });

  it('sets the outcome, waiting, error line and link button at body 13 weight 600', () => {
    for (const rule of ['cx-outcome', 'cx-waiting', 'cx-errline', 'cx-linkbtn']) {
      expect(CONNECTIONS_CSS).toMatch(
        new RegExp(`\\.${rule} \\{[^}]*${typeCss('body')}; font-weight: 600`),
      );
    }
  });

  it('keeps a name on one line, with its chips beside it', () => {
    expect(CONNECTIONS_CSS).not.toMatch(/\.cx-row__name \{[^}]*flex-wrap: wrap/);
    expect(CONNECTIONS_CSS).toMatch(
      /\.cx-row__name > span:first-child \{[^}]*white-space: nowrap[^}]*text-overflow: ellipsis/,
    );
  });

  it('styles the add form: a segmented control, label-above fields, a two-column grid', () => {
    expect(CONNECTIONS_CSS).toMatch(/\.cx-seg \{[^}]*border-radius: 12px/);
    expect(CONNECTIONS_CSS).toMatch(/\.cx-input \{[^}]*height: 36px/);
    expect(CONNECTIONS_CSS).toMatch(/\.cx-two \{[^}]*grid-template-columns: 1fr 1fr/);
  });

  it('spaces the cards, the group label, the community note and the quiet buttons like the mockup', () => {
    expect(CONNECTIONS_CSS).toMatch(
      /\.cx-panel \{[^}]*display: flex[^}]*flex-direction: column[^}]*gap: 20px/,
    );
    expect(CONNECTIONS_CSS).toMatch(/\.cx-group-label \{[^}]*margin: 8px 0 -6px/);
    expect(CONNECTIONS_CSS).toMatch(
      new RegExp(`\\.cx-grp-note \\{[^}]*margin: -2px 0 0[^}]*${typeCss('small')}`),
    );
    expect(CONNECTIONS_CSS).toMatch(/\.cx-quiet \{[^}]*gap: 2px/);
    expect(CONNECTIONS_CSS).toMatch(/\.cx-quiet \.tg-button \{[^}]*padding: 0 8px/);
  });

  it('gives the Popular section the card gap and takes no space for an empty status line', () => {
    expect(CONNECTIONS_CSS).toMatch(
      /\.cx-section \{[^}]*display: flex[^}]*flex-direction: column[^}]*gap: 16px/,
    );
    expect(CONNECTIONS_CSS).toMatch(/\.cx-search \{[^}]*gap: 0/);
    expect(CONNECTIONS_CSS).toMatch(/\.cx-search__status:not\(:empty\) \{[^}]*margin-top: 6px/);
  });

  it('draws the search status line only with text, so it has no minimum height', () => {
    expect(CONNECTIONS_CSS).not.toMatch(/\.cx-search__status \{[^}]*min-height/);
  });

  it('sets text only through the type roles, with no capitals or letter spacing', () => {
    expect(CONNECTIONS_CSS).toContain(typeCss('bodyLead'));
    expect(CONNECTIONS_CSS).toContain(typeCss('small'));
    expect(CONNECTIONS_CSS).not.toMatch(/text-transform|letter-spacing/);
  });
});
