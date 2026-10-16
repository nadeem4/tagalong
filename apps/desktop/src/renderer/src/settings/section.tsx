/**
 * Building blocks every Settings section uses: SECTIONS (ids and titles, in page order),
 * Section, the ⓘ Info button and its Tip, and the context that marks the field a save refused.
 */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/** The sections in the order the page shows them; the standalone window's nav links to each. */
export const SECTIONS = [
  { id: 'brain', title: 'How Scout thinks' },
  { id: 'you', title: 'You' },
  { id: 'privacy', title: 'Privacy' },
  { id: 'budget', title: 'Daily budget' },
  { id: 'voice', title: 'Voice' },
  { id: 'shortcuts', title: 'Shortcuts' },
  { id: 'browser', title: 'Browser extension (optional)' },
  { id: 'advanced', title: 'Advanced' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * What every section reads from the page: which ⓘ note is open (one at a time), and the
 * field a save refused, so that field can say so itself.
 */
export interface SettingsUi {
  tip: string | null;
  toggleTip: (id: string) => void;
  invalid: { field: string; message: string } | null;
}

export const SettingsUiContext = createContext<SettingsUi>({
  tip: null,
  toggleTip: () => undefined,
  invalid: null,
});

/** One panel with a short pixel heading, and an ⓘ beside it when it has a longer note. */
export function Section({
  id,
  info,
  children,
}: {
  id: Exclude<SectionId, 'advanced'>;
  info?: { tip: string; label: string };
  children: ReactNode;
}) {
  const title = SECTIONS.find((section) => section.id === id)?.title ?? id;
  return (
    <section id={id} className="tg-panel" aria-labelledby={`${id}-heading`}>
      <div className="tg-titlerow">
        <h2 id={`${id}-heading`} className="tg-px tg-panel__heading">
          {title}
        </h2>
        {info !== undefined && <Info tip={info.tip} label={info.label} />}
      </div>
      {children}
    </section>
  );
}

/** The ⓘ button: a real button that opens its note inline, below. */
export function Info({ tip, label }: { tip: string; label: string }) {
  const ui = useContext(SettingsUiContext);
  const open = ui.tip === tip;
  return (
    <button
      type="button"
      className="tg-info"
      aria-label={label}
      aria-expanded={open}
      aria-controls={`tip-${tip}`}
      onClick={() => ui.toggleTip(tip)}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 11v5M12 7.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** The longer note an ⓘ opens. Only one is open at a time. */
export function Tip({ tip, children }: { tip: string; children: ReactNode }) {
  const ui = useContext(SettingsUiContext);
  if (ui.tip !== tip) return null;
  return (
    <p className="tg-tip" id={`tip-${tip}`}>
      {children}
    </p>
  );
}

/**
 * The attributes that mark a field the last save refused, and the message under it.
 * Every other field gets nothing, so a fixed field stops saying it is wrong.
 */
export function useInvalid(field: string): {
  props: { 'aria-invalid'?: true; 'aria-describedby'?: string; id: string };
  message: ReactNode;
} {
  const { invalid } = useContext(SettingsUiContext);
  const id = `f-${field}`;
  if (invalid?.field !== field) return { props: { id }, message: null };
  return {
    props: { id, 'aria-invalid': true, 'aria-describedby': `${id}-error` },
    message: (
      <p className="tg-error tg-field-error" id={`${id}-error`}>
        {invalid.message}
      </p>
    ),
  };
}
