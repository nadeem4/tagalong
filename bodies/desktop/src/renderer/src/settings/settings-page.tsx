/**
 * Settings: the form, one section per file in this folder, saved as one patch through
 * settings-form.ts. It is the Settings page of Home; there is no standalone window.
 */
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { SETTINGS_CSS } from '@tagalong/ui';
import { SettingsFieldError, buildSettingsPatch, isAdvancedField } from '../settings-form';
import { AdvancedSection } from './advanced-section';
import { BrowserSection } from './browser-section';
import { ElevenLabsSection } from './elevenlabs-section';
import { PrivacySection } from './privacy-section';
import { SettingsUiContext } from './section';
import type { SettingsUi } from './section';
import { ShortcutsSection } from './shortcuts-section';
import { VoiceSection } from './voice-section';
import type { BrowserFolder, HostView } from '../../../shared/ipc';

/**
 * Sections in page order: Privacy, Voice, Shortcuts, the browser, then
 * Advanced (the ElevenLabs voice), closed by default. Main re-registers hotkeys on save.
 */
export function SettingsPage() {
  const [view, setView] = useState<HostView | null>(null);
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [browserFolder, setBrowserFolder] = useState<BrowserFolder | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<SettingsUi['invalid']>(null);
  const [status, setStatus] = useState('');
  // A refused save has to look refused. Rendering it in the same muted style as "Saved."
  // is how a user reads a rejection as a confirmation and walks away.
  const [statusIsError, setStatusIsError] = useState(false);

  useEffect(() => {
    window.tagalongHost
      .getHostView()
      .then(setView)
      .catch((error: unknown) => {
        setStatus(String(error));
        setStatusIsError(true);
      });
  }, []);

  useEffect(() => {
    window.tagalongHost
      .browserFolder()
      .then(setBrowserFolder)
      .catch(() => setBrowserFolder(null));
  }, []);

  // Saving a fixed accelerator re-registers it in main, which is where the outcome is
  // known. Without this the window would keep showing the old failure next to the very
  // field that just corrected it.
  useEffect(
    () =>
      window.tagalongHost.onHotkeyProblem((problem) =>
        setView((current) => {
          if (current === null) return current;
          // Rebuilt without the key rather than spread over: spreading `{}` for the
          // fixed case would leave the stale error exactly where it is least welcome.
          const { hotkeyError: _cleared, ...rest } = current;
          return problem === null ? rest : { ...rest, hotkeyError: problem };
        }),
      ),
    [],
  );

  // A refused field is focused once it is on screen, Advanced opened if need be.
  useEffect(() => {
    if (invalid !== null) document.getElementById(`f-${invalid.field}`)?.focus();
  }, [invalid]);

  const ui = useMemo<SettingsUi>(
    () => ({
      tip,
      toggleTip: (id) => setTip((open) => (open === id ? null : id)),
      invalid,
    }),
    [tip, invalid],
  );

  if (view === null) {
    return (
      <main className="tg-settings">
        <style>{SETTINGS_CSS}</style>
        <p style={{ padding: 20 }}>{status === '' ? 'Loading…' : status}</p>
      </main>
    );
  }

  const { settings } = view;

  const removeElevenLabsKey = async (): Promise<void> => {
    try {
      // An empty key deletes the stored one.
      await window.tagalongHost.saveElevenLabsKey('');
      setView((current) =>
        current === null ? current : { ...current, elevenLabsKeyStored: false },
      );
      setStatus('ElevenLabs key removed.');
      setStatusIsError(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setStatusIsError(true);
    }
  };

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (view === null) return;
    const form = new FormData(event.currentTarget);
    const field = (name: string): string => String(form.get(name) ?? '');
    try {
      // Everything is validated before anything is written, so a typo in one field cannot
      // leave the hotkeys saved and the keys not.
      const patch = buildSettingsPatch({
        askHotkey: field('askHotkey'),
        pauseSightHotkey: field('pauseSightHotkey'),
        stopVoiceHotkey: field('stopVoiceHotkey'),
        talkHotkey: field('talkHotkey'),
        microphoneId: field('microphoneId'),
        mouth: field('mouth'),
        ears: field('ears'),
        voiceEnabled: form.get('voiceEnabled') !== null,
        voice: field('voice'),
        voiceSpeed: field('voiceSpeed'),
        elevenLabsVoiceId: field('elevenLabsVoiceId'),
        rollingMemoryEnabled: form.get('rollingMemoryEnabled') !== null,
        rollingMemoryMinutes: field('rollingMemoryMinutes'),
      });
      const saved = await window.tagalongHost.saveSettings(patch);
      // An empty box is left alone: removing the key is the Remove key button's job.
      const typed = elevenLabsKey.trim();
      if (typed.length > 0) await window.tagalongHost.saveElevenLabsKey(typed);
      setElevenLabsKey('');
      setView((current) =>
        current === null
          ? current
          : {
              ...current,
              settings: saved,
              elevenLabsKeyStored: current.elevenLabsKeyStored || typed.length > 0,
            },
      );
      setInvalid(null);
      setStatus('Saved. Scout uses it from the next ask.');
      setStatusIsError(false);
    } catch (error) {
      // The builders throw with the field named, so this reaches the user as
      // "Watches at once must be…" beside that very field, Advanced opened if it is there.
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof SettingsFieldError) {
        if (isAdvancedField(error.field)) setAdvanced(true);
        setInvalid({ field: error.field, message });
      } else {
        setInvalid(null);
      }
      setStatus(message);
      setStatusIsError(true);
    }
  }

  return (
    <SettingsUiContext.Provider value={ui}>
      <form className="tg-settings tg-settings--embedded" onSubmit={(event) => void save(event)}>
        <style>{SETTINGS_CSS}</style>
        <main className="tg-main">
          <div className="tg-intro">
            <div className="tg-intro__text">
              <h1 className="tg-intro__title">Settings</h1>
              <p className="tg-help">
                Everything works out of the box. Change only what you need. Press{' '}
                <span aria-hidden="true">ⓘ</span>
                <span className="tg-sr">the information button</span> for more on any setting.
              </p>
            </div>
            <button type="submit" className="tg-btn">
              Save
            </button>
          </div>
          <PrivacySection settings={settings} platform={view.platform} />
          <VoiceSection settings={settings} hotkeyError={view.hotkeyError} />
          <ShortcutsSection settings={settings} hotkeyError={view.hotkeyError} />
          <BrowserSection folder={browserFolder} />
          <AdvancedSection open={advanced} onToggle={() => setAdvanced((open) => !open)}>
            <ElevenLabsSection
              settings={settings}
              keyStored={view.elevenLabsKeyStored}
              typed={elevenLabsKey}
              onType={setElevenLabsKey}
              onRemove={() => void removeElevenLabsKey()}
            />
          </AdvancedSection>
          <div className="tg-footer">
            <button type="submit" className="tg-btn">
              Save
            </button>
            {status === '' ? (
              <p>Changes apply from the next ask.</p>
            ) : (
              <p
                className={statusIsError ? 'tg-error' : 'tg-saved'}
                role={statusIsError ? 'alert' : 'status'}
              >
                {statusIsError ? `Not saved. ${status}` : status}
              </p>
            )}
          </div>
        </main>
      </form>
    </SettingsUiContext.Provider>
  );
}
