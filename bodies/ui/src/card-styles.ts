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
.card-rows dt { width: 56px; flex: none; font-size: 12px; color: #A3AAC4; }
.card-rows dd { flex: 1; min-width: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.card-rows dd small { font-size: 11px; color: #A3AAC4; overflow-wrap: anywhere; }
.card-rows > div > .bubble-quiet { align-self: center; flex: none; }
.card-brief { font-size: 12px; line-height: 1.5; color: #C9CEE0; }
.connector-details { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow-y: auto; }
`;
