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
`;
