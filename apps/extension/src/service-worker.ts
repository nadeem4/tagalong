/**
 * Chrome MV3 host entry point.
 *
 * This host never imports @tagalong/core. It speaks the protocol over the loopback
 * websocket and nothing else.
 */

// The toolbar button opens the side panel. It is also the user gesture that grants
// activeTab, which is what lets the panel read the page it was opened on.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
