/**
 * Tests for the popup's pure part: the status sentence and the list of what Scout has
 * been allowed, turned into plain rows.
 */
import { describe, expect, it } from 'vitest';
import {
  grantRows,
  micButton,
  micClick,
  statusLine,
  showContextMenusOffer,
  voiceLine,
} from './model';
import type { VoiceView } from '../voice/voice-session';

describe('showContextMenusOffer', () => {
  it('contextMenus_offer_is_shown_only_until_granted', () => {
    expect(showContextMenusOffer(['storage'])).toBe(true);
    expect(showContextMenusOffer(['storage', 'contextMenus'])).toBe(false);
  });
});

describe('statusLine', () => {
  it('has_one_sentence_per_status', () => {
    expect(statusLine('connecting')).toBe("Connecting to Scout's brain...");
    expect(statusLine('online')).toBe("Connected to Scout's brain");
    expect(statusLine('offline')).toBe("Scout's brain is not reachable");
    expect(statusLine('outdated')).toBe(
      'Needs an update: this browser add-on is older than the brain',
    );
  });
});

describe('grantRows', () => {
  it('lists_only_what_scout_can_ask_for', () => {
    const rows = grantRows({ permissions: ['storage', 'history', 'alarms'], origins: [] });
    expect(rows).toEqual([{ label: 'history', need: { kind: 'permission', name: 'history' } }]);
  });

  it('turns_origins_into_site_names', () => {
    const rows = grantRows({ permissions: [], origins: ['https://x.com/*', 'http://a.b.org/*'] });
    expect(rows).toEqual([
      { label: 'x.com', need: { kind: 'site', origin: 'https://x.com' } },
      { label: 'a.b.org', need: { kind: 'site', origin: 'http://a.b.org' } },
    ]);
  });

  it('shows_granted_local_files_as_one_row', () => {
    const rows = grantRows({ permissions: [], origins: ['file:///*'] });
    expect(rows).toEqual([{ label: 'Local files', need: { kind: 'site', origin: 'file://' } }]);
  });

  it('collapses_all_urls_to_one_row', () => {
    const rows = grantRows({ permissions: [], origins: ['<all_urls>', 'https://x.com/*'] });
    expect(rows[0]).toEqual({ label: 'All sites', need: { kind: 'site', origin: '<all_urls>' } });
    expect(rows).toHaveLength(1);
  });

  it('is_empty_when_nothing_is_granted', () => {
    expect(grantRows({ permissions: ['storage'], origins: [] })).toEqual([]);
  });
});

const view = (state: VoiceView['state'], text = '', error = ''): VoiceView => ({
  state,
  text,
  error,
  loading: false,
  progress: 0,
});

describe('the mic button', () => {
  it('reads_ask_by_voice_then_done_talking_and_is_off_while_thinking', () => {
    expect(micButton(view('idle'))).toEqual({ label: 'Ask by voice', disabled: false });
    expect(micButton(view('error'))).toEqual({ label: 'Ask by voice', disabled: false });
    expect(micButton(view('listening'))).toEqual({ label: 'Done talking', disabled: false });
    expect(micButton(view('thinking'))).toEqual({ label: 'Asking...', disabled: true });
  });

  it('a_click_starts_when_the_mic_is_allowed_and_asks_for_it_when_not', () => {
    expect(micClick(view('idle'), 'granted')).toBe('start');
    expect(micClick(view('error'), 'granted')).toBe('start');
    expect(micClick(view('idle'), 'prompt')).toBe('ask-permission');
    expect(micClick(view('idle'), 'denied')).toBe('ask-permission');
  });

  it('a_click_while_listening_stops_and_while_thinking_does_nothing', () => {
    expect(micClick(view('listening'), 'granted')).toBe('stop');
    expect(micClick(view('thinking'), 'granted')).toBe('none');
  });
});

describe('voiceLine', () => {
  it('says_what_is_happening_in_plain_words', () => {
    expect(voiceLine(view('idle'))).toBe('');
    expect(voiceLine(view('listening'))).toBe('Listening. Click Done talking when you finish.');
    expect(voiceLine(view('listening', 'what is'))).toBe('what is');
    expect(voiceLine(view('thinking'))).toBe('Working out what you said...');
    expect(voiceLine({ ...view('thinking'), loading: true, progress: 0.426 })).toBe(
      "Getting Scout's ears ready (43%)",
    );
    expect(voiceLine({ ...view('listening'), loading: true })).toBe(
      "Getting Scout's ears ready (0%)",
    );
    expect(voiceLine(view('idle', 'what is this'))).toBe(
      'Asked: "what is this". The answer shows on your desktop.',
    );
    expect(voiceLine(view('error', '', "Scout's brain is not reachable."))).toBe(
      "Scout's brain is not reachable.",
    );
  });
});
