/**
 * The shared look of the bubble's cards (connector confirm, drop, approved, health): a column
 * with a rows table and a small brief line. Contains CARD_CSS. Used by the bubble.
 */

export const CARD_CSS = `
.card { display: flex; flex-direction: column; gap: 10px; }
.card-rows { display: flex; flex-direction: column; gap: 0; margin: 0; border-top: 1px solid #262C4A; }
.card-rows > div {
  display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #262C4A;
}
.card-rows dt { width: 56px; flex: none; font-size: 12px; line-height: 16px; font-weight: 400; color: #A3AAC4; }
.card-rows dd { flex: 1; min-width: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; line-height: 20px; font-weight: 400; }
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
`;
