/**
 * The companion chat's look beyond the shared bubble sheet: Scout's mark and name on lines Scout
 * starts, the quiet line, the full chat. Injected after BUBBLE_CSS so these rules win. Padding
 * rule: anything bordered or filled that holds text keeps at least 8px inside (12 to 16 for
 * cards and message tiles); only keycaps and small pills are tighter. Contains CHAT_CSS.
 */
import { themeTokens as t } from './theme/tokens';

export const CHAT_CSS = `
/* Who is talking: Bean's still tile and the name, only on lines Scout starts. */
.scout-mark {
  flex: none; display: flex; align-items: center; justify-content: center; overflow: hidden;
  border-radius: 30%; background: #222845;
}
.bubble-who {
  display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 16px;
  font-weight: ${t.fontWeight.semibold}; color: ${t.color.text};
}
.bubble-hint { font-size: 11px; line-height: 16px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.textMuted}; }
/* The quiet line reading aloud: the same three bars as the speaking button, not pressable. */
.bubble-bars { display: inline-flex; align-items: center; gap: 3px; margin-left: 2px; }
.bubble-bars span {
  width: 3px; border-radius: 2px; background: ${t.color.gold};
  transform: scaleY(calc(0.3 + var(--tg-voice-level, 0.4) * 0.7)); transition: transform 90ms linear;
}
.bubble-bars span:nth-child(1) { height: 8px; }
.bubble-bars span:nth-child(2) { height: 14px; }
.bubble-bars span:nth-child(3) { height: 10px; }
@media (prefers-reduced-motion: reduce) { .bubble-bars span { transform: none; transition: none; } }

.bubble--line { padding: 12px 8px 12px 14px; gap: 8px; }
.bubble--line:hover { border-color: #3A4270; }
.bubble--line .bubble-top { align-items: flex-start; }
.bubble-say {
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}

/* The close and back buttons are drawn icons. */
.bubble-close, .bubble-icon { display: grid; place-items: center; padding: 0; }
.bubble-icon {
  flex: none; width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent;
  color: ${t.color.textMuted}; cursor: pointer;
}
.bubble-icon:hover { background: #222845; color: ${t.color.text}; }
.bubble-icon:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
.bubble-sep { width: 1px; height: 16px; background: ${t.color.line}; margin: 0 2px; }

/* The pills: on is a gold dot with a muted gold edge, off a plain edge. */
.bubble-toggle[aria-checked='true'] { color: ${t.color.text}; border-color: #6B5A2A; background: #1E1D2A; }
.bubble-toggle[aria-checked='true']::before { background: ${t.color.gold}; }

/* Context chips: a pill with its remove button inside. */
.bubble-chip { min-height: 28px; padding: 0 8px 0 12px; }

/* The full chat: a 52px header, a log pinned to the newest message, then the footer. */
.bubble--chat { height: 100vh; padding: 0; gap: 0; overflow: hidden; }
.bubble-head {
  flex: none; box-sizing: border-box; height: 52px; display: flex; align-items: center; gap: 8px;
  padding: 0 8px 0 16px; border-bottom: 1px solid ${t.color.line}; background: ${t.color.sidebar};
}
.bubble-head strong {
  margin-right: auto; font-family: ${t.font.wordmark}; font-weight: ${t.fontWeight.wordmark};
  font-size: 16px; line-height: 20px; letter-spacing: -0.01em;
}
.bubble-head .bubble-toggle { min-height: 26px; }
.bubble-head .bubble-row { gap: 8px; }
.bubble-log {
  flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 24px;
  padding: 20px 16px 20px 20px; scrollbar-width: thin; scrollbar-color: ${t.color.fieldLine} transparent;
}
/* Short conversations sit at the bottom, beside the field. */
.bubble-log > :first-child { margin-top: auto; }
.bubble-exchange { display: flex; flex-direction: column; gap: 12px; }
.bubble-mine {
  align-self: flex-end; max-width: 82%; margin: 0; padding: 12px 16px; border-radius: 12px 12px 4px 12px;
  background: #222845; font-size: 14px; line-height: 21px; white-space: pre-wrap;
}
.bubble-scoutmsg { display: flex; flex-direction: column; gap: 6px; }
`;
