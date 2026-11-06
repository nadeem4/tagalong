/**
 * How Scout reads the screen on this PC: window text (UI Automation) and text from pictures
 * (Windows OCR), found with one read-only PowerShell script that needs no elevation.
 * Contains READING_SCRIPT, DETECT_TIMEOUT_MS, parseReading and detectReading.
 */

import type { ReadingEventData } from '@tagalong/contract';

export type ReadingStatus = ReadingEventData;
export type ReadingRow = ReadingStatus['rows'][number];

export const DETECT_TIMEOUT_MS = 20_000;

/**
 * One line per fact. Never Get-WindowsCapability: it needs administrator rights, and
 * detection must not prompt. OcrEngine answers "can this person's languages be read" directly.
 */
export const READING_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
if ($null -ne $root) { 'window-text=ok' } else { 'window-text=fail' }
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -ne $engine) { 'ocr=ok' } else { 'ocr=missing' }
$display = Get-WinUILanguageOverride
if ([string]::IsNullOrEmpty($display)) { $display = (Get-UICulture).Name }
"display=$display"
"profile=" + ((Get-WinUserLanguageList).LanguageTag -join ',')
`;

/** The same shape the contract allows, so nothing odd reaches a command line later. */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

function facts(stdout: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of stdout.replace(/\r\n/g, '\n').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) found.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return found;
}

const WINDOW_TEXT: ReadingRow = {
  capability: 'window-text',
  engine: 'windows-uia',
  where: 'this-pc',
  state: 'not-working',
};
const PICTURE_TEXT: ReadingRow = {
  capability: 'text-from-pictures',
  engine: 'windows-ocr',
  where: 'this-pc',
  state: 'not-working',
};

/** Turns the script's lines into rows. Anything unclear reads as not-working, never as working. */
export function parseReading(stdout: string): ReadingStatus {
  const found = facts(stdout);
  const windowText: ReadingRow = {
    ...WINDOW_TEXT,
    state: found.get('window-text') === 'ok' ? 'working' : 'not-working',
  };

  const ocr: ReadingRow = { ...PICTURE_TEXT };
  const display = found.get('display') ?? '';
  if (found.get('ocr') === 'ok') {
    ocr.state = 'working';
  } else if (found.get('ocr') === 'missing' && LANGUAGE_TAG.test(display)) {
    ocr.state = 'needs-language-pack';
    ocr.language = display;
    const profile = (found.get('profile') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');
    if (profile.length > 0) ocr.profile_languages = profile.slice(0, 20);
  }
  return { rows: [windowText, ocr] };
}

/** Never rejects: a runner that throws reads as both rows not working. */
export async function detectReading(
  run: (script: string, timeoutMs: number) => Promise<string>,
): Promise<ReadingStatus> {
  try {
    return parseReading(await run(READING_SCRIPT, DETECT_TIMEOUT_MS));
  } catch {
    return parseReading('');
  }
}
