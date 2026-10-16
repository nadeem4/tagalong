/**
 * Settings' You section: what Scout calls you. Optional: an emptied box clears it, and Scout
 * then uses no name.
 */
import { MAX_USER_NAME_CHARS } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';
import { Info, Section, Tip } from './section';

export function YouSection({ settings }: { settings: Settings }) {
  return (
    <Section id="you">
      <div className="tg-labelrow">
        <label htmlFor="f-userName">What should Scout call you?</label>
        <Info tip="userName" label="About your name" />
      </div>
      <input
        id="f-userName"
        name="userName"
        defaultValue={settings.userName}
        placeholder="Your first name"
        maxLength={MAX_USER_NAME_CHARS}
        autoComplete="given-name"
      />
      <Tip tip="userName">
        Scout uses it rarely: in a hello, or a moment that warrants it, never in every reply. It is
        stored on this computer and sent to the AI provider only as part of Scout&apos;s prompt.
        Leave it empty and Scout uses no name.
      </Tip>
    </Section>
  );
}
