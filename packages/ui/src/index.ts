/**
 * React components shared by the desktop renderer and the extension side panel.
 *
 * This package must never import electron or reach for a socket. Hosts hand it a
 * HostBridge and the components talk to nothing else.
 */
export { HostBridgeProvider, useHostBridge } from './host-bridge';
export type {
  AskInput,
  ConfirmHandoff,
  HostBridge,
  HostBridgeProviderProps,
  TurnEvent,
} from './host-bridge';

export { PetAvatar } from './pet-avatar';
export type { PetAvatarProps, PetState } from './pet-avatar';

export { MessageList } from './message-list';
export type { ChatMessage, MessageListProps } from './message-list';

export { Composer } from './composer';
export type { ComposerProps } from './composer';

export { SightBar, estimateImageTokens } from './sight-bar';
export type { SightBarProps, SightProblem } from './sight-bar';

export { CrewStrip, DEFAULT_PET_COLOR } from './crew-strip';
export type { CrewStripProps } from './crew-strip';

export { ChatPanel } from './chat-panel';
export { CompanionBubble } from './companion-bubble';
export type { CompanionBubbleProps } from './companion-bubble';
export type { ChatPanelProps } from './chat-panel';

/** Exported so hosts can test their renderer wiring without booting an engine. */
export { createFakeHostBridge } from './test-support/fake-host-bridge';
export type { FakeHostBridge } from './test-support/fake-host-bridge';

/** Home: the control centre. Its centre scene is a theme; everything else is fixed chrome. */
export { HomeView } from './home/home-view';
export type { HomeViewProps } from './home/home-view';
export type { AgentHost } from './home/agent-controls';
export { THEMES, themeById } from './home/themes';
export type { Placement, SceneProps, Theme, ThemeLayout, Whereabouts } from './home/theme';
export { PixelSprite } from './office/pixel-sprite';
export { characterFor } from './office/sprites/characters';
export type { PixelSpriteProps } from './office/pixel-sprite';

export { PetSettings } from './settings/pet-settings';
export type { PetDraft, PetSettingsProps } from './settings/pet-settings';
export type { ModelRecommendation } from './settings/brain-picker';
export { CrewList } from './settings/crew-list';
export { SETTINGS_CSS } from './settings/settings-styles';

/** Phase 8. A role's label and class ink, for hosts that name a pet's role outside the office. */
export { jobFor } from './office/job';
export { officeTokens } from './office/tokens';
