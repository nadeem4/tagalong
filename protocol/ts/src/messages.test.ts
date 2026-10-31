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
  TabEventData,
  TurnParams,
  type BodyToBrainMethod,
  type BrainToBodyMethod,
} from './messages.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '../../examples/valid');
const eventData = (name: string): unknown =>
  JSON.parse(readFileSync(join(examples, `body.event.params.${name}.json`), 'utf8')).params.data;

describe('method maps', () => {
  it('has literal body to brain method names', () => {
    expectTypeOf<BodyToBrainMethod>().toEqualTypeOf<
      'hello' | 'tools' | 'say' | 'event' | 'call' | 'answer' | 'cancel'
    >();
  });
  it('has literal brain to body method names', () => {
    expectTypeOf<BrainToBodyMethod>().toEqualTypeOf<
      'use' | 'cancel' | 'reply' | 'turn' | 'tool' | 'ask' | 'changed' | 'approved'
    >();
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
