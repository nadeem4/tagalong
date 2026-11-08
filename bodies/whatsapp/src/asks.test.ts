/** Tests for the ask desk: how an open ask is shown, and how a tap or a text answers it. */
import { describe, expect, test } from 'vitest';
import { AskDesk, type OpenAsk } from './asks';

const ask = (over: Partial<OpenAsk> = {}): OpenAsk => ({
  seq: 1,
  id: 'a1',
  state: 'open',
  text: 'Run the build?',
  options: ['allow', 'deny'],
  ...over,
});

describe('AskDesk', () => {
  test('test_three_short_options_become_buttons_carrying_the_ask_id', () => {
    const out = new AskDesk().open(ask({ options: ['allow', 'always', 'deny'] }));
    expect(out).toEqual({
      kind: 'buttons',
      body: 'Run the build?',
      buttons: [
        { id: 'ask:a1:0', title: 'allow' },
        { id: 'ask:a1:1', title: 'always' },
        { id: 'ask:a1:2', title: 'deny' },
      ],
    });
  });

  test('test_four_options_become_numbered_text', () => {
    const out = new AskDesk().open(ask({ options: ['one', 'two', 'three', 'four'] }));
    expect(out).toEqual({
      kind: 'text',
      body: 'Run the build?\n\n1. one\n2. two\n3. three\n4. four',
    });
  });

  test('test_a_long_option_falls_back_to_text', () => {
    const long = 'x'.repeat(21);
    const out = new AskDesk().open(ask({ options: ['allow', long] }));
    expect(out).toEqual({ kind: 'text', body: `Run the build?\n\n1. allow\n2. ${long}` });
  });

  test('test_free_text_ask_is_text', () => {
    const out = new AskDesk().open(ask({ options: ['reply'], free_text: true }));
    expect(out?.kind).toBe('text');
    expect(out?.body).toContain('1. reply');
    expect(out?.body).toContain('Type your reply');
  });

  test('test_the_same_ask_is_not_shown_twice', () => {
    const desk = new AskDesk();
    expect(desk.open(ask())).not.toBeNull();
    expect(desk.open(ask())).toBeNull();
  });

  test('test_number_word_and_yes_no_all_answer_a_single_ask', () => {
    const desk = new AskDesk();
    desk.open(ask());
    expect(desk.fromText('2')).toEqual({ ask: 'a1', option: 'deny' });
    expect(desk.fromText(' Allow ')).toEqual({ ask: 'a1', option: 'allow' });
    expect(desk.fromText('yes')).toEqual({ ask: 'a1', option: 'allow' });
    expect(desk.fromText('No')).toEqual({ ask: 'a1', option: 'deny' });
  });

  test('test_text_that_matches_nothing_is_not_an_answer', () => {
    const desk = new AskDesk();
    desk.open(ask());
    expect(desk.fromText('what time is it')).toBeNull();
    expect(desk.fromText('7')).toBeNull();
    expect(desk.fromText('0')).toBeNull();
  });

  test('test_free_text_answer_carries_the_text', () => {
    const desk = new AskDesk();
    desk.open(ask({ options: ['reply'], free_text: true }));
    expect(desk.fromText('the blue one')).toEqual({
      ask: 'a1',
      option: 'reply',
      text: 'the blue one',
    });
    expect(desk.fromText('   ')).toBeNull();
  });

  test('test_no_open_ask_is_null_and_two_make_text_ambiguous', () => {
    const desk = new AskDesk();
    expect(desk.fromText('yes')).toBeNull();
    desk.open(ask({ id: 'a1' }));
    desk.open(ask({ id: 'a2' }));
    expect(desk.fromText('yes')).toEqual({ ambiguous: true });
  });

  test('test_a_button_answers_with_its_option', () => {
    const desk = new AskDesk();
    desk.open(ask());
    expect(desk.fromButton('ask:a1:1')).toEqual({ ask: 'a1', option: 'deny' });
  });

  test('test_unknown_button_is_closed', () => {
    const desk = new AskDesk();
    desk.open(ask());
    expect(desk.fromButton('ask:zz:0')).toEqual({ closed: true });
    expect(desk.fromButton('ask:a1:9')).toEqual({ closed: true });
    expect(desk.fromButton('junk')).toEqual({ closed: true });
  });

  test('test_close_forgets_the_ask', () => {
    const desk = new AskDesk();
    desk.open(ask());
    expect(desk.ids()).toEqual(['a1']);
    desk.close('a1');
    expect(desk.ids()).toEqual([]);
    expect(desk.fromButton('ask:a1:0')).toEqual({ closed: true });
    expect(desk.open(ask())).not.toBeNull();
  });
});
