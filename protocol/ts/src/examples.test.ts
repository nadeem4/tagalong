/**
 * Checks every sample frame in protocol/examples against the schemas. The same files
 * are read by the Python tests, so a drift between the two implementations shows up
 * as a failing example rather than a silent disagreement.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { bodyToBrain, brainToBody } from './messages.js';
import { ErrorObject } from './shapes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../examples');

interface Sample {
  file: string;
  from: string;
  method: string;
  kind: string;
  frame: Record<string, unknown>;
}

function load(dir: 'valid' | 'invalid'): Sample[] {
  return readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      const [from, method, kind] = file.split('.');
      const frame = JSON.parse(readFileSync(join(root, dir, file), 'utf8'));
      return { file, from: from!, method: method!, kind: kind!, frame };
    });
}

function schemaFor(s: Sample): ZodType {
  if (s.kind === 'error') return ErrorObject;
  const entry = (s.from === 'body' ? bodyToBrain : brainToBody)[s.method];
  if (!entry) throw new Error(`${s.file}: no such method ${s.method}`);
  const schema = s.kind === 'params' ? entry.params : entry.result;
  if (!schema) throw new Error(`${s.file}: ${s.method} has no ${s.kind}`);
  return schema;
}

describe('valid examples', () => {
  const samples = load('valid');

  it.each(samples.map((s) => [s.file, s] as const))('%s parses', (_file, s) => {
    expect(s.frame['jsonrpc']).toBe('2.0');
    const result = schemaFor(s).safeParse(s.frame[s.kind]);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it.each([
    ['body', bodyToBrain],
    ['brain', brainToBody],
  ] as const)(
    'every %s method has a params example, and a result if it is a request',
    (from, map) => {
      for (const [method, entry] of Object.entries(map)) {
        const has = (kind: string) =>
          samples.some((s) => s.from === from && s.method === method && s.kind === kind);
        expect(has('params'), `${from}.${method} params`).toBe(true);
        if (entry.result) expect(has('result'), `${from}.${method} result`).toBe(true);
      }
    },
  );
});

describe('invalid examples', () => {
  it.each(load('invalid').map((s) => [s.file, s] as const))('%s is rejected', (_file, s) => {
    expect(schemaFor(s).safeParse(s.frame[s.kind]).success).toBe(false);
  });
});
