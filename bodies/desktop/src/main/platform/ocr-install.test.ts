/** Tests for installOcrLanguage, on a fake runner: nothing here installs or elevates. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INSTALL_TIMEOUT_MS,
  buildElevatedScript,
  buildInstallScript,
  installOcrLanguage,
} from './ocr-install';

afterEach(() => {
  vi.useRealTimers();
});

describe('installOcrLanguage', () => {
  it('installs and reports installed', async () => {
    const run = vi.fn().mockResolvedValue('#installed\r\n');
    const result = await installOcrLanguage(run, 'fr-FR');
    expect(result.outcome).toBe('installed');
  });

  it('reports declined when the administrator prompt is refused', async () => {
    const run = vi.fn().mockResolvedValue('#declined');
    const result = await installOcrLanguage(run, 'fr-FR');
    expect(result.outcome).toBe('declined');
    expect(result.message).toMatch(/administrator/i);
  });

  it('reports failed with the reason', async () => {
    const run = vi.fn().mockResolvedValue('#failed:no such capability');
    const result = await installOcrLanguage(run, 'fr-FR');
    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('no such capability');
  });

  it('reports failed when the script printed nothing', async () => {
    const result = await installOcrLanguage(vi.fn().mockResolvedValue(''), 'fr-FR');
    expect(result.outcome).toBe('failed');
  });

  it('reports failed when the runner throws', async () => {
    const result = await installOcrLanguage(vi.fn().mockRejectedValue(new Error('gone')), 'fr-FR');
    expect(result.outcome).toBe('failed');
  });

  it('reports still-installing when the runner outlasts INSTALL_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => new Promise<string>(() => {}));
    const pending = installOcrLanguage(run, 'fr-FR');
    await vi.advanceTimersByTimeAsync(INSTALL_TIMEOUT_MS + 1);
    expect((await pending).outcome).toBe('still-installing');
  });

  it('lets the runner outlast the time limit, so the limit answers first', async () => {
    const run = vi.fn().mockResolvedValue('#installed');
    await installOcrLanguage(run, 'fr-FR');
    expect(run.mock.calls[0]?.[1]).toBeGreaterThan(INSTALL_TIMEOUT_MS);
  });

  it.each(['en-US; calc', '', 'en US', "en-US'", '$(calc)', 'en-US\nx'])(
    'rejects %j as invalid-language and never calls the runner',
    async (tag) => {
      const run = vi.fn();
      const result = await installOcrLanguage(run, tag);
      expect(result.outcome).toBe('invalid-language');
      expect(run).not.toHaveBeenCalled();
    },
  );
});

describe('the install scripts', () => {
  it('asks for administrator rights with RunAs -Wait and turns a refusal into #declined', () => {
    const script = buildInstallScript('fr-FR');
    expect(script).toContain('Start-Process');
    expect(script).toMatch(/-Verb RunAs/);
    expect(script).toMatch(/-Wait/);
    expect(script).toContain('-EncodedCommand');
    expect(script).toContain('#declined');
  });

  it('stops on any error from both calls, so a non-terminating failure cannot report installed', () => {
    const elevated = buildElevatedScript('fr-FR');
    expect(elevated.match(/-ErrorAction Stop/g)).toHaveLength(2);
    expect(elevated).toMatch(/Get-WindowsCapability[^\n]*-ErrorAction Stop/);
    expect(elevated).toMatch(/Add-WindowsCapability[^\n]*-ErrorAction Stop/);
  });

  it('exits 4 (failed) when the lookup itself throws, and 3 only when no pack matched', () => {
    const elevated = buildElevatedScript('fr-FR');
    const lookup = elevated.indexOf('Get-WindowsCapability');
    expect(elevated.lastIndexOf('try', lookup)).toBeGreaterThanOrEqual(0);
    expect(elevated).toMatch(/catch \{ exit 4 \}/);
    expect(elevated).toContain('exit 3');
    expect(buildInstallScript('fr-FR')).toMatch(/ExitCode -eq 3\) \{ '#failed:Windows has no text/);
  });

  it('finds the exact capability name inside the elevated process, never outside it', () => {
    const elevated = buildElevatedScript('fr-FR');
    expect(elevated).toContain('Language.OCR~~~fr-FR~*');
    expect(elevated).toContain('Get-WindowsCapability');
    expect(elevated).toContain('Add-WindowsCapability');
    expect(buildInstallScript('fr-FR')).not.toContain('Get-WindowsCapability');
  });
});
