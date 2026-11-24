/**
 * The sheet for the brain step and the Pair a device dialog: path cards, found brains, server
 * commands, the link form, alerts and the dialog with its QR. Contains PAIR_CSS. Colours that
 * change with the theme use themedColor; the code blocks and QR stay navy and white in both.
 */
import { themeTokens as t, themedColor, typeCss } from '../theme/tokens';

export const PAIR_CSS = `
.pair-paths { margin-top: ${t.space.xxl}px; max-width: 640px; }
.pair-diag { flex: none; width: 132px; height: 56px; color: ${themedColor.panelMuted}; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.pair-diag .pair-diag__brain { fill: ${t.color.gold}; stroke: none; }
.pair-meta { ${typeCss('small')}; color: ${themedColor.panelMuted}; }
.pair-label { display: block; margin: 0 0 4px; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; }
.pair-keep { display: flex; align-items: center; justify-content: space-between; gap: ${t.space.lg}px; margin-top: ${t.space.xl}px; max-width: 640px; }
.pair-keep > span { display: flex; flex-direction: column; gap: 2px; }
.pair-keep strong { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }

.pair-found { margin-top: ${t.space.xxl}px; max-width: 640px; }
.pair-foundlist { list-style: none; margin: 0; padding: 0 16px; }
.pair-foundlist li { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; border-top: 1px solid ${themedColor.panelLine}; }
.pair-foundlist li:first-child { border-top: 0; }
.pair-foundlist li > div { display: flex; flex-direction: column; }

.pair-server, .pair-form { margin-top: ${t.space.xxl}px; max-width: 640px; }
.pair-form { margin-top: ${t.space.xl}px; }
.pair-commands { list-style: none; margin: ${t.space.lg}px 0 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.md}px; }
.pair-commands li, .pair-copy { display: flex; align-items: stretch; gap: 8px; }
.pair-code { flex: 1; min-width: 0; padding: ${t.space.md}px ${t.space.lg}px; border-radius: ${t.radius.sm}px; background: ${t.color.page}; color: ${t.color.textSoft}; border: 1px solid ${t.color.fieldLine}; font-family: ${t.font.mono}; ${typeCss('small')}; overflow-wrap: anywhere; user-select: all; }
.pair-input { flex: 1; min-width: 0; height: 40px; padding: 0 12px; border-radius: ${t.radius.sm}px; border: 1px solid ${themedColor.keycapLine}; background: ${themedColor.controlFill}; color: ${themedColor.panelText}; font-family: ${t.font.mono}; ${typeCss('small')}; }

.pair-alert { display: flex; flex-direction: column; gap: 2px; margin: ${t.space.lg}px 0 0; padding: 12px; border-radius: ${t.radius.card}px; background: ${themedColor.warnFill}; color: ${themedColor.warnInk}; ${typeCss('small')}; max-width: 640px; }
.pair-alert--err { background: ${themedColor.errFill}; color: ${themedColor.errInk}; }
.pair-alert--ok { background: ${themedColor.okFill}; color: ${themedColor.okInk}; font-weight: ${t.fontWeight.semibold}; }
.pair-alert--ok .pair-meta { color: inherit; font-weight: normal; }

.pair-scrim { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 24px; background: rgba(8, 10, 24, 0.55); }
.pair-dialog { width: 600px; max-width: 100%; display: flex; flex-direction: column; gap: ${t.space.xl}px; padding: 20px 24px; border-radius: ${t.radius.card}px; border: 1px solid ${themedColor.panelLine}; background: ${themedColor.card}; color: ${themedColor.panelText}; }
.pair-dialog h2 { margin: 0; ${typeCss('title')}; }
.pair-dialog .pair-alert { margin: 0; max-width: none; }
.pair-grid { display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: start; }
.pair-scan { display: flex; flex-direction: column; gap: 8px; align-items: center; }
.pair-qrbox { padding: 12px; border-radius: ${t.radius.card}px; background: ${t.color.qrPaper}; line-height: 0; border: 1px solid ${themedColor.panelLine}; }
.pair-qr { width: 168px; height: 168px; display: block; fill: ${t.color.qrInk}; }
.pair-qr .pair-qr__light { fill: ${t.color.qrPaper}; }
.pair-link { display: flex; flex-direction: column; }
.pair-expiry { display: flex; flex-direction: column; gap: 8px; }
.pair-expiry__row { display: flex; justify-content: space-between; }
.pair-waiting { display: inline-flex; align-items: center; gap: 8px; }
.pair-dot { width: 8px; height: 8px; border-radius: 50%; background: ${themedColor.okDot}; }
.pair-bar { height: 4px; border-radius: ${t.radius.sm}px; background: ${themedColor.panelTile}; overflow: hidden; }
.pair-bar > i { display: block; height: 100%; background: ${t.color.gold}; }
.pair-actions { display: flex; justify-content: flex-end; gap: 8px; }
`;
