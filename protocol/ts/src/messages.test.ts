/**
 * Type-level pin: the method maps expose their literal method names, so bodies can
 * type a method argument without repeating the list. Also pins
 * started_by on turns and the back and focus event data.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ApprovedParams,
  BackEventData,
  DownloadEventData,
  FocusEventData,
  HeardParams,
  ListenParams,
  ReadAloudEventData,
  SayParams,
  SpeechParams,
  TabEventData,
  TurnParams,
  VoiceParams,
  brainToBody,
  type BodyToBrainMethod,
  type BrainToBodyMethod,
} from './messages.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '../../examples/valid');
const eventData = (name: string): unknown =>
  JSON.parse(readFileSync(join(examples, `body.event.params.${name}.json`), 'utf8')).params.data;

describe('method maps', () => {
  it('has literal body to brain method names', () => {
    expectTypeOf<BodyToBrainMethod>().toEqualTypeOf<
      | 'hello'
      | 'tools'
      | 'say'
      | 'event'
      | 'call'
      | 'answer'
      | 'cancel'
      | 'listen'
      | 'mic'
      | 'unlisten'
      | 'hush'
    >();
  });
  it('has literal brain to body method names', () => {
    expectTypeOf<BrainToBodyMethod>().toEqualTypeOf<
      | 'use'
      | 'cancel'
      | 'reply'
      | 'turn'
      | 'tool'
      | 'ask'
      | 'changed'
      | 'approved'
      | 'heard'
      | 'voice'
      | 'speech'
    >();
  });
});

describe('voice messages', () => {
  it('marks the voice notifications live and the rest not', () => {
    for (const m of ['heard', 'voice', 'speech'] as const) {
      expect('live' in brainToBody[m] && brainToBody[m].live).toBe(true);
    }
    expect('live' in brainToBody.reply).toBe(false);
  });
  it('bounds say speed and listen mode', () => {
    expect(SayParams.safeParse({ text: 'a', speed: 0.5 }).success).toBe(true);
    expect(SayParams.safeParse({ text: 'a', speed: 2 }).success).toBe(true);
    expect(SayParams.safeParse({ text: 'a', speed: 3 }).success).toBe(false);
    expect(ListenParams.safeParse({ mode: 'held' }).success).toBe(true);
    expect(ListenParams.safeParse({ mode: 'x' }).success).toBe(false);
  });
  it('keeps speech either text or done, and pcm with its rate', () => {
    expect(SpeechParams.safeParse({ turn: 't', done: true, text: 'x' }).success).toBe(false);
    expect(SpeechParams.safeParse({ turn: 't' }).success).toBe(false);
    expect(SpeechParams.safeParse({ turn: 't', text: 'x', pcm: 'AA==' }).success).toBe(false);
    expect(SpeechParams.safeParse({ turn: 't', text: 'x', sample_rate: 24000 }).success).toBe(
      false,
    );
    expect(
      SpeechParams.safeParse({ turn: 't', text: 'x', pcm: 'AA==', sample_rate: 24000 }).success,
    ).toBe(true);
  });
  it('bounds voice progress', () => {
    expect(VoiceParams.safeParse({ status: 'loading', progress: 1.5 }).success).toBe(false);
    expect(HeardParams.safeParse({ event: 'mumble' }).success).toBe(false);
  });
});

describe('back and focus event data', () => {
  it('parses the examples', () => {
    expect(BackEventData.parse(eventData('back')).idle_seconds).toBe(420);
    expect(FocusEventData.parse(eventData('focus'))).toEqual({
      app: 'Code.exe',
      title: 'protocol.py - tagalong',
    });
  });
  it('rejects negative idle seconds', () => {
    expect(BackEventData.safeParse({ idle_seconds: -1 }).success).toBe(false);
  });
});

describe('tab and download event data', () => {
  it('parses the examples', () => {
    expect(TabEventData.parse(eventData('tab'))).toEqual({
      title: 'Release notes',
      url: 'https://example.com/releases',
    });
    expect(DownloadEventData.parse(eventData('download'))).toEqual({
      name: 'report.pdf',
      state: 'complete',
    });
  });
  it('rejects a bad download state and a tab without a url', () => {
    expect(DownloadEventData.safeParse({ name: 'a', state: 'started' }).success).toBe(false);
    expect(TabEventData.safeParse({ title: 'x' }).success).toBe(false);
  });
});

describe('read_aloud event data', () => {
  it('parses the example and bounds speed', () => {
    expect(ReadAloudEventData.parse(eventData('read_aloud'))).toEqual({
      on: true,
      voice: 'bm_george',
      speed: 1.1,
      system_voice: false,
    });
    expect(ReadAloudEventData.safeParse({ on: false }).success).toBe(true);
    expect(ReadAloudEventData.safeParse({ on: true, system_voice: true }).success).toBe(true);
    expect(ReadAloudEventData.safeParse({ on: true, system_voice: 1 }).success).toBe(false);
    expect(ReadAloudEventData.safeParse({}).success).toBe(false);
    expect(ReadAloudEventData.safeParse({ on: true, speed: 3 }).success).toBe(false);
  });
});

describe('turn started_by', () => {
  const started = { seq: 1, turn: 't', body: 'b', state: 'started' };
  it('is optional', () => {
    expect(TurnParams.safeParse(started).success).toBe(true);
    expect(TurnParams.safeParse({ ...started, started_by: 'brain' }).success).toBe(true);
    expect(TurnParams.safeParse({ ...started, started_by: 'oops' }).success).toBe(false);
  });
});

describe('approved notification', () => {
  const ok = { seq: 3, tool: 'open_file', text: 'Open the file', preference: 'Allow reads' };
  it('accepts an approved notification', () => {
    expect(ApprovedParams.safeParse(ok).success).toBe(true);
  });
  it('rejects an approved notification without a preference', () => {
    const { preference: _, ...rest } = ok;
    expect(ApprovedParams.safeParse(rest).success).toBe(false);
  });
});
