/**
 * The shared look of the bubble's cards (connector confirm, drop, approved, health): a column
 * with a rows table and a small brief line. Contains CARD_CSS. Used by the bubble.
 */

import { themeTokens as t } from './theme/tokens';

export const CARD_CSS = `
.card { display: flex; flex-direction: column; gap: 10px; }
/* The ask's facts: a muted label and its value, two columns under a hairline. */
.card-rows { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 10px 0 0; border-top: 1px solid #262C4A; }
.card-rows > div { display: grid; grid-template-columns: 56px 1fr; gap: 14px; align-items: start; }
.card-rows dt { font-size: 12px; line-height: 20px; font-weight: 400; color: #A3AAC4; }
.card-rows dd { min-width: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; line-height: 20px; font-weight: 400; overflow-wrap: anywhere; }
.card-rows dd small { font-size: 11px; line-height: 14px; font-weight: 600; color: #A3AAC4; overflow-wrap: anywhere; }
.card-rows > div > .bubble-quiet { align-self: center; flex: none; }
.bubble-choices { display: flex; flex-direction: column; gap: 6px; }
.bubble-choices .bubble-choice {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
  box-sizing: border-box; height: auto; min-height: 36px; padding: 8px 12px; text-align: left; overflow-wrap: anywhere; font-size: 13px; line-height: 20px; font-weight: 400;
}
.bubble-choices .bubble-choice.bubble-quiet { align-self: stretch; }
.bubble-choices .bubble-choice.bubble-quiet:hover { background: rgba(255, 255, 255, 0.06); }
.bubble-choices .bubble-choice.bubble-primary:hover { filter: brightness(1.06); }
.bubble-tag {
  flex: none; padding: 1px 6px; border-radius: 999px; background: rgba(18, 22, 43, 0.14);
  font-size: 11px; line-height: 14px; font-weight: 600;
}
.card-brief { font-size: 12px; line-height: 16px; font-weight: 400; color: #C9CEE0; }
.connector-details { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow-y: auto; }
.card-head { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
.card-head p { flex: 1 1 200px; margin: 0; font-weight: 600; }
.card-chip {
flex: none; display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px;
background: #222845; color: #C9CEE0; font-size: 11px; line-height: 14px; font-weight: 600;
}
.card-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.card-actions button { align-self: auto; height: 32px; min-height: 32px; padding: 0 14px; border-radius: 8px; font-size: 13px; }
.bubble-radio { flex: none; width: 16px; height: 16px; box-sizing: border-box; border-radius: 50%; border: 1.5px solid ${t.color.textMuted}; }
.bubble-choice-text { flex: 1; min-width: 0; }
.bubble-choices .bubble-choice, .bubble-choices .bubble-choice.bubble-primary {
justify-content: flex-start; padding: 10px 12px; border: 1px solid ${t.color.fieldLine}; border-radius: 10px;
background: transparent; color: ${t.color.text};
}
.bubble-choices .bubble-choice.bubble-primary { border-color: ${t.color.gold}; background: rgba(242, 193, 78, 0.07); }
.bubble-choices .bubble-choice.bubble-primary .bubble-radio { border: 5px solid ${t.color.gold}; }
.bubble-choices .bubble-choice .bubble-tag { background: rgba(242, 193, 78, 0.16); color: ${t.color.gold}; }
`;
