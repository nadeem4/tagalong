/**
 * React components shared by the desktop renderer and the extension side panel.
 *
 * This package must never import electron or reach for a socket. Hosts hand it a
 * HostBridge and the components talk to nothing else.
 */
export { HostBridgeProvider, useHostBridge } from './host-bridge';
export type { AskInput, HostBridge, HostBridgeProviderProps, TurnEvent } from './host-bridge';

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
export type { ChatPanelProps } from './chat-panel';

/** Exported so hosts can test their renderer wiring without booting an engine. */
export { createFakeHostBridge } from './test-support/fake-host-bridge';
export type { FakeHostBridge } from './test-support/fake-host-bridge';
