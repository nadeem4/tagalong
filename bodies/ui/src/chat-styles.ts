/**
 * The companion chat's look beyond the shared bubble sheet: Scout's mark and name on lines Scout
 * starts, the quiet line, the full chat. Injected after BUBBLE_CSS so these rules win. Padding
 * rule: anything bordered or filled that holds text keeps at least 8px inside (12 to 16 for
 * cards and message tiles); only keycaps and small pills are tighter. Contains CHAT_CSS.
 */
import { themeTokens as t, typeCss } from './theme/tokens';

export const CHAT_CSS = `
/* Who is talking: Bean's still tile and the name, only on lines Scout starts. */
.scout-mark {
  flex: none; display: flex; align-items: center; justify-content: center; overflow: hidden;
  border-radius: 30%; background: #222845;
}
.bubble-who {
  display: flex; align-items: center; gap: 8px; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.text};
}
.bubble-hint { ${typeCss('caption')}; color: ${t.color.textMuted}; }
/* The quiet line reading aloud: the speaking button's bars (styled in companion-bubble), not pressable. */
.bubble-bars { display: inline-flex; align-items: center; gap: 3px; margin-left: 2px; }
.bubble-bars span:nth-child(1) { height: 8px; }
.bubble-bars span:nth-child(2) { height: 14px; }
.bubble-bars span:nth-child(3) { height: 10px; }

.bubble--line { padding: 12px 8px 12px 14px; gap: 8px; }
.bubble--line:hover { border-color: #3A4270; }
.bubble--line .bubble-top { align-items: flex-start; }
.bubble-say {
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}

/* Header icon buttons (close, back, expand, mic, eye): 32px, gold fill when pressed. */
.bubble-tg {
  position: relative; flex: none; width: 32px; height: 32px; display: grid; place-items: center;
  padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent;
  color: ${t.color.textMuted}; cursor: pointer;
}
.bubble-tg:hover { background: #222845; color: ${t.color.text}; }
.bubble-tg:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 1px; }
.bubble-tg[aria-pressed='true'] {
  color: ${t.color.gold}; background: rgba(242, 193, 78, 0.12); border-color: rgba(242, 193, 78, 0.35);
}
.bubble-sep { width: 1px; height: 16px; background: ${t.color.line}; margin: 0 2px; }
/* The tooltip sits under its button and shows on hover or keyboard focus. */
.bubble-tgwrap { position: relative; display: inline-flex; }
.bubble-tip {
  display: none; position: absolute; z-index: 3; top: 40px; right: 0; width: max-content; max-width: 220px;
  padding: 8px 10px; border-radius: 8px; background: #E9ECF5; color: #12162B;
  ${typeCss('small')}; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.bubble-tgwrap:hover .bubble-tip, .bubble-tgwrap:focus-within .bubble-tip { display: block; }
.bubble-tip-sub { display: block; margin-top: 2px; color: #4A5168; }

/* Context chips: a pill with its remove button inside. Long names wrap, never cut. */
.bubble-chip { min-height: 28px; padding: 0 8px 0 12px; }
.bubble-chip span { overflow-wrap: anywhere; }

/* A running job: the expert, then the whole step in mono, wrapped. */
.bubble-jobline { overflow-wrap: anywhere; }
.bubble-jobline code { font-family: ${t.font.mono}; }

/* The full chat: a 56px header, a log pinned to the newest message, then the footer. */
.bubble--chat { height: 100vh; padding: 0; gap: 0; overflow: hidden; }
.bubble-head {
  flex: none; box-sizing: border-box; height: 56px; display: flex; align-items: center; gap: 10px;
  padding: 0 8px 0 12px; border-bottom: 1px solid ${t.color.line}; background: ${t.color.sidebar};
}
.bubble-head--quick { height: 52px; }
.bubble--quick { padding: 0; gap: 0; }
.bubble-compact { display: flex; flex-direction: column; gap: 12px; padding: 12px; }
.bubble-headwho { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.bubble-head strong { font-family: ${t.font.wordmark}; ${typeCss('bodyLead')}; font-weight: 600; }
.bubble-headstatus { display: flex; align-items: center; gap: 6px; ${typeCss('caption')}; font-weight: 400; color: ${t.color.textMuted}; overflow-wrap: anywhere; }
.bubble-priv { flex: none; width: 6px; height: 6px; border-radius: 50%; background: ${t.color.gold}; box-shadow: 0 0 0 3px rgba(242, 193, 78, 0.18); }
.bubble-head .bubble-row { flex: none; gap: 4px; }
.bubble-log {
  flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 24px;
  padding: 20px 16px 20px 20px; scrollbar-width: thin; scrollbar-color: ${t.color.fieldLine} transparent;
}
/* Short conversations sit at the bottom, beside the field. */
.bubble-log > :first-child { margin-top: auto; }
.bubble-exchange { display: flex; flex-direction: column; gap: 12px; }
.bubble-mine {
  align-self: flex-end; max-width: 82%; margin: 0; padding: 10px 14px; border-radius: 14px 14px 4px 14px;
  background: ${t.color.mine}; ${typeCss('bodyLead')}; white-space: pre-wrap; overflow-wrap: anywhere;
}
.bubble-scout { display: grid; grid-template-columns: 24px 1fr; gap: 12px; align-items: start; max-width: 60ch; }
.bubble-scout-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.bubble-scoutmsg { display: flex; flex-direction: column; gap: 6px; }

/* A turn in progress: the thinking row with Stop beside it, then a gold cursor on the text. */
.bubble-live { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.bubble-thinking { display: flex; align-items: center; gap: 10px; ${typeCss('body')}; color: #C9CEE0; }
.bubble-dots { display: inline-flex; align-items: center; gap: 4px; }
.bubble-dots i { width: 6px; height: 6px; border-radius: 50%; background: ${t.color.gold}; animation: bubble-dot 1.2s ease-in-out infinite; }
.bubble-dots i:nth-child(2) { animation-delay: 0.15s; }
.bubble-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes bubble-dot { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .bubble-dots i { animation: none; } }
.bubble-stop { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px 0 8px; }
.bubble-stop i { width: 8px; height: 8px; border-radius: 2px; background: #C9CEE0; display: block; }
.bubble--chat .bubble-answer { max-height: none; overflow: visible; }
.bubble-streaming .answer > :last-child::after {
  content: ''; display: inline-block; width: 2px; height: 16px; margin-left: 2px; border-radius: 1px;
  background: ${t.color.gold}; vertical-align: -3px;
}
.bubble-field textarea[aria-busy='true'] { opacity: 0.55; }

/* The composer: a bordered row, the text box growing inside, then mic and send. */
.bubble-field {
  flex: none; position: relative; display: flex; flex-direction: row; align-items: flex-end; gap: 6px;
  padding: 8px 8px 8px 12px; border: 1px solid ${t.color.fieldLine}; border-radius: 12px; background: ${t.color.field};
}
.bubble-field:focus-within { border-color: ${t.color.sky}; box-shadow: 0 0 0 3px rgba(124, 184, 242, 0.18); }
.bubble-field textarea {
  flex: 1; min-width: 0; max-height: 120px; padding: 4px 0; border: 0; outline: 0; resize: none;
  background: transparent; color: ${t.color.text}; font: inherit; ${typeCss('bodyLead')}; overflow-wrap: anywhere;
}
.bubble-field textarea::placeholder { color: ${t.color.textMuted}; }
.bubble-field .bubble-mic, .bubble-send {
  flex: none; position: static; width: 32px; height: 32px; display: grid; place-items: center;
  padding: 0; border: 0; border-radius: 8px; background: transparent; color: ${t.color.textMuted}; cursor: pointer;
}
.bubble-send { background: ${t.color.gold}; color: ${t.color.goldInk}; }
.bubble-send:disabled { background: #222845; color: ${t.color.textMuted}; cursor: default; }
.bubble-send:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 1px; }

/* The empty chat: Bean, the one sentence, and the real talk key. */
.bubble-empty {
  margin: auto 0; display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 24px 40px; text-align: center;
}
.bubble-empty p { margin: 0; max-width: 260px; ${typeCss('bodyLead')}; color: #C9CEE0; }
.bubble-empty-key { display: inline-flex; align-items: center; gap: 4px; ${typeCss('caption')}; color: ${t.color.textMuted}; }

/* The approval card in the chat: the card surface, 16px inside. */
.bubble--chat .card {
  padding: 16px; border: 1px solid ${t.color.fieldLine}; border-radius: 10px; background: ${t.color.sidebar};
}
`;
