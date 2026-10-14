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

export { MessageList } from './message-list';
export type { ChatMessage, MessageListProps } from './message-list';

export { Composer } from './composer';
export type { ComposerProps } from './composer';

export { SightBar, estimateImageTokens } from './sight-bar';
export type { SightBarProps, SightProblem } from './sight-bar';

export { ChatPanel } from './chat-panel';
export { CompanionBubble, GreetingLine } from './companion-bubble';
export { DockPet } from './dock-pet';
export type { DockPetProps } from './dock-pet';
export type { DockMood } from './office/sprites/expressions';
export type { BubbleTalk, CompanionBubbleProps, GreetingLineProps } from './companion-bubble';
export type { ChatPanelProps } from './chat-panel';

/** Exported so hosts can test their renderer wiring without booting an engine. */
export { createFakeHostBridge } from './test-support/fake-host-bridge';
export type { FakeHostBridge } from './test-support/fake-host-bridge';

/** Home: the one window for the companion, its experts, activity and settings. */
export { HomeView } from './home/home-view';
export type { HomeHost, HomePage, HomeProvider, HomeViewProps } from './home/home-view';
export { brainLabel, modelLabel } from './home/brain-label';
export { PixelSprite } from './office/pixel-sprite';
export { characterFor } from './office/sprites/characters';
export type { PixelSpriteProps } from './office/pixel-sprite';

export { SETTINGS_CSS } from './settings/settings-styles';

/** Scout talks: what a bubble line sounds like, and the queue that says one at a time. */
export { SpeechQueue } from './voice/speech-queue';
export type { PreparedLine, SpeechQueueOptions } from './voice/speech-queue';
export { QueueMouth } from './voice/mouth';
export { toSpeakable } from './voice/speakable';
/** Talk to Scout: telling a held key from a fresh press, and the bubble's side of it. */
export { PushToTalk } from './voice/push-to-talk';
export type { TalkAction } from './voice/push-to-talk';
export { ListenController } from './voice/listen-controller';
export type { ListenControllerOptions, ListenMic } from './voice/listen-controller';
export { officeTokens } from './office/tokens';
