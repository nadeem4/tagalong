import { officeTokens as t } from './tokens';

/**
 * The few rules inline styles cannot express — hover, focus, placeholders, keyframes,
 * reduced motion, selection and scrollbars — built from the tokens and scoped under
 * `.office` so the sheet never leaks into a host's other pages.
 */
export const OFFICE_CSS = `
.office ::selection { background: ${t.color.gold}; color: ${t.color.goldInk}; }
.office :focus-visible {
  outline: ${t.size.focusRing}px solid ${t.color.gold};
  outline-offset: ${t.size.focusOffset}px;
}
.office ::-webkit-scrollbar { width: 8px; height: 8px; }
.office ::-webkit-scrollbar-track { background: transparent; }
.office ::-webkit-scrollbar-thumb { background: ${t.color.scrollbarThumb}; border-radius: 4px; }
.office-px { font-family: ${t.font.pixel}; }
.office-bob { animation: office-bob ${t.timing.bob} steps(1) infinite; }
@keyframes office-bob { 0% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.office-hop { animation: office-hop ${t.timing.hop} steps(1) infinite; }
@keyframes office-hop { 0% { transform: translateY(0); } 50% { transform: translateY(3px); } }
@media (prefers-reduced-motion: reduce) { .office-bob, .office-hop { animation: none; } }
.office-row {
  display: flex; align-items: center; gap: ${t.space.lg}px; width: 100%;
  padding: ${t.space.md}px; border: 2px solid transparent; border-radius: ${t.radius.row}px;
  background: transparent; cursor: pointer; text-align: left;
  font-family: ${t.font.ui}; color: ${t.color.text};
}
.office-row:hover { background: ${t.color.rowActive}; }
.office-row[aria-pressed='true'] { background: ${t.color.rowActive}; border-color: ${t.color.gold}; }
.office-field {
  height: ${t.size.fieldHeight}px; box-sizing: border-box; padding: 0 ${t.space.lg}px;
  border-radius: ${t.radius.field}px; font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px;
}
.office-field::placeholder { color: ${t.color.textMuted}; opacity: 1; }
.office-btn {
  height: ${t.size.fieldHeight}px; padding: 0 ${t.space.xl}px; border-radius: ${t.radius.field}px;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold};
  border: 1px solid ${t.color.gold}; background: ${t.color.gold}; color: ${t.color.goldInk};
  cursor: pointer;
}
.office-field:disabled, .office-btn:disabled { cursor: not-allowed; }
.office-btn:disabled {
  background: transparent; border-color: ${t.color.fieldLine}; color: ${t.color.textMuted};
}
`;
