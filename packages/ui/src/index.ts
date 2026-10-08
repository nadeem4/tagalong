/**
 * React components shared by the desktop renderer and the extension side panel.
 *
 * This package must never import electron or reach for a socket. Hosts hand it a
 * HostBridge and the components talk to nothing else.
 */
export { HostBridgeProvider, useHostBridge } from './host-bridge';
export type { AskInput, HostBridge, HostBridgeProviderProps, TurnEvent } from './host-bridge';

/** The one pet docked on the desktop, with its state marks and helper badges. */
export { DesktopCompanion, COMPANION_SIZE } from './companion/desktop-companion';
export type { DesktopCompanionProps } from './companion/desktop-companion';
export { SightPermission } from './sight-permission';
export type { SightPermissionProps } from './sight-permission';

export { MessageList } from './message-list';
export type { ChatMessage, MessageListProps } from './message-list';

export { Composer } from './composer';
export type { ComposerProps } from './composer';

export { SightBar, estimateImageTokens } from './sight-bar';
export type { SightBarProps, SightProblem } from './sight-bar';

export { CrewStrip, DEFAULT_PET_COLOR } from './crew-strip';
export type { CrewStripProps } from './crew-strip';

export { ChatPanel } from './chat-panel';
export type { ChatPanelProps } from './chat-panel';

/** Exported so hosts can test their renderer wiring without booting an engine. */
export { createFakeHostBridge } from './test-support/fake-host-bridge';
export type { FakeHostBridge } from './test-support/fake-host-bridge';

export { OfficeView } from './office/office-view';
export { PixelSprite } from './office/pixel-sprite';
export type { PixelSpriteProps } from './office/pixel-sprite';

export { PetSettings } from './settings/pet-settings';
export type { PetDraft, PetSettingsProps } from './settings/pet-settings';
export type { ModelRecommendation } from './settings/brain-picker';
export { CrewList } from './settings/crew-list';
export { SETTINGS_CSS } from './settings/settings-styles';

/** Phase 8. A role's label and class ink, for hosts that name a pet's role outside the office. */
export { jobFor } from './office/job';
export { officeTokens } from './office/tokens';
