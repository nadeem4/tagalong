import { describe, expect, it, vi } from 'vitest';
import { NO_RECOGNISER, OCR_SCRIPT, parseOcr, recognizeText } from './ocr';

describe('the text recognition script', () => {
  it('uses the recogniser built into Windows and reads the picture from stdin', () => {
    expect(OCR_SCRIPT).toContain('Windows.Media.Ocr.OcrEngine');
    expect(OCR_SCRIPT).toContain('[Console]::In.ReadToEnd()');
    // Never a file: a screenshot is not written to disk.
    expect(OCR_SCRIPT).not.toMatch(/StorageFile|Set-Content|Out-File/);
  });

  it('names the generic AsTask with its backtick, which a template string could swallow', () => {
    expect(OCR_SCRIPT).toContain("'IAsyncOperation`1'");
  });
});

describe('parseOcr', () => {
  it('returns the recognised lines', () => {
    expect(parseOcr('PS C:> npm test\r\nError: expected 3\r\n')).toBe(
      'PS C:> npm test\nError: expected 3',
    );
  });

  it('reads as empty when Windows has no recogniser for these languages', () => {
    expect(parseOcr(`${NO_RECOGNISER}\r\n`)).toBe('');
  });
});

describe('recognizeText', () => {
  it('hands the picture over as input and returns the text', async () => {
    const run = vi.fn().mockResolvedValue('hello\r\n');
    expect(await recognizeText(run, 'cG5n')).toBe('hello');
    expect(run).toHaveBeenCalledWith(OCR_SCRIPT, expect.any(Number), 'cG5n');
  });

  it('reads as empty rather than failing the read when PowerShell throws', async () => {
    expect(await recognizeText(vi.fn().mockRejectedValue(new Error('gone')), 'cG5n')).toBe('');
  });
});
