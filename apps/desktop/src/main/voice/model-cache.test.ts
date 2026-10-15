import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDownloaded } from './model-cache';

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'tagalong-models-'));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

function partial(model: string): string {
  const dir = join(cacheDir, model);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'model.onnx'), 'half a file');
  return dir;
}

describe('isDownloaded', () => {
  it('says whether a model’s file is in the cache, without fetching anything', () => {
    expect(isDownloaded(cacheDir, 'acme/model', 'model.onnx')).toBe(false);
    partial('acme/model');
    expect(isDownloaded(cacheDir, 'acme/model', 'model.onnx')).toBe(true);
    expect(isDownloaded(cacheDir, 'acme/model', 'onnx/model_quantized.onnx')).toBe(false);
  });
});
