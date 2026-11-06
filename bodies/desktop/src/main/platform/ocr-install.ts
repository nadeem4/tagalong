/**
 * Installing Windows' text-recognition pack for one language, after the person said yes.
 * The install needs administrator rights, so one outer script asks Windows to elevate an
 * inner one (Windows shows its own prompt). Never run in tests or CI.
 * Contains installOcrLanguage, buildInstallScript, buildElevatedScript and INSTALL_TIMEOUT_MS.
 */

import { ReadingRow } from '@tagalong/contract';

/** How long the tool waits before saying "still installing". The brain waits a little longer. */
export const INSTALL_TIMEOUT_MS = 600_000;

/** The runner may outlast the limit by this much, so the limit's answer always comes first. */
const RUNNER_GRACE_MS = 5_000;

export interface InstallResult {
  outcome: 'installed' | 'declined' | 'failed' | 'still-installing' | 'invalid-language';
  message: string;
}

type Run = (script: string, timeoutMs: number) => Promise<string>;

/**
 * Runs inside the elevated process. The capability name is resolved here because looking it
 * up needs elevation too, and detection deliberately never prompts. The tag has already
 * passed the contract's language-tag check, so it holds no quote or shell character.
 */
export function buildElevatedScript(language: string): string {
  // -ErrorAction Stop on both: a non-terminating error must not fall through to exit 0. A
  // failed lookup (offline, servicing policy) is exit 4, not 3, which means "no such pack".
  return [
    'try {',
    `$c = Get-WindowsCapability -Online -Name 'Language.OCR~~~${language}~*' -ErrorAction Stop | Select-Object -First 1`,
    'if ($null -eq $c) { exit 3 }',
    'Add-WindowsCapability -Online -Name $c.Name -ErrorAction Stop | Out-Null',
    'exit 0',
    '} catch { exit 4 }',
  ].join('\n');
}

/** Starts the elevated script and turns how it ended into one marker line. */
export function buildInstallScript(language: string): string {
  const encoded = Buffer.from(buildElevatedScript(language), 'utf16le').toString('base64');
  return [
    "$ErrorActionPreference = 'Stop'",
    `try { $p = Start-Process -FilePath powershell -ArgumentList '-NoProfile','-EncodedCommand','${encoded}' -Verb RunAs -Wait -PassThru } catch { '#declined'; exit 0 }`,
    "if ($p.ExitCode -eq 0) { '#installed' }",
    "elseif ($p.ExitCode -eq 3) { '#failed:Windows has no text recognition pack for this language' }",
    "else { '#failed:Windows could not install it (exit code ' + $p.ExitCode + ')' }",
  ].join('\n');
}

function resultOf(stdout: string): InstallResult {
  const line = stdout.replace(/\r\n/g, '\n').trim().split('\n').pop()?.trim() ?? '';
  if (line === '#installed') {
    return { outcome: 'installed', message: 'The text recognition pack is installed.' };
  }
  if (line === '#declined') {
    return {
      outcome: 'declined',
      message:
        'Windows asked for administrator permission and it was not given, so nothing was installed.',
    };
  }
  if (line.startsWith('#failed:')) {
    return { outcome: 'failed', message: `The install did not work: ${line.slice(8)}.` };
  }
  return { outcome: 'failed', message: 'The install did not report back, so it may not have run.' };
}

/** Never rejects. An overrun answers "still installing"; the next detection shows the truth. */
export async function installOcrLanguage(run: Run, language: string): Promise<InstallResult> {
  if (!ReadingRow.shape.language.safeParse(language).success || language === '') {
    return {
      outcome: 'invalid-language',
      message: `"${language.slice(0, 20)}" is not a language tag, so nothing was installed.`,
    };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<InstallResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          outcome: 'still-installing',
          message: 'Windows is still installing it. Check again in a few minutes.',
        }),
      INSTALL_TIMEOUT_MS,
    );
  });
  const attempt = run(buildInstallScript(language), INSTALL_TIMEOUT_MS + RUNNER_GRACE_MS).then(
    resultOf,
    (): InstallResult => resultOf(''),
  );
  try {
    return await Promise.race([attempt, limit]);
  } finally {
    clearTimeout(timer);
  }
}
