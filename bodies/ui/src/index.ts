/**
 * The public surface of @tagalong/ui: React components and helpers shared by the desktop
 * renderer and the extension side panel. Contains the HostBridge contract and its provider,
 * the bubble, dock pet, chat panel, Home, the Settings sheet, Scout's voice helpers and the
 * fake bridge for host tests. Never imports electron or opens a socket: hosts hand it a
 * HostBridge.
 */
export { HostBridgeProvider } from './host-bridge';
export type {
  AskInput,
  ConfirmHandoff,
  HostBridge,
  PermissionRow,
  SpendToday,
  TurnEvent,
} from './host-bridge';

export { ChatPanel } from './chat-panel';
export { CompanionBubble, GreetingLine } from './companion-bubble';
export type { DropOffer } from './drop-card';
export { DockPet } from './dock-pet';
export type { BeanFigure, DockMood, DockPetProps, ListeningDot } from './dock-pet';
export { BeanClip } from './theme/bean-clip';
export type { BeanClipData } from './theme/bean-clip';
export type { BubbleTalk, CompanionBubbleProps, GreetingLineProps } from './companion-bubble';
export type { ChatPanelProps } from './chat-panel';

/** Exported so hosts can test their renderer wiring without booting an engine. */
export { createFakeHostBridge } from './test-support/fake-host-bridge';

/** Home: the one window for the companion, its experts, activity and settings. */
export { HomeView } from './home/home-view';
export type { HomeHost, HomePage, HomeViewProps } from './home/home-view';
export { brainLabel } from './home/brain-label';

export { SETTINGS_CSS } from './settings/settings-styles';

/** Scout talks: the queue that says one line at a time, and the mouth that plays it. */
export { SpeechQueue } from './voice/speech-queue';
export { QueueMouth } from './voice/mouth';
/** Talk to Scout: telling a held key from a fresh press, and the bubble's side of it. */
export { PushToTalk } from './voice/push-to-talk';
export type { TalkAction } from './voice/push-to-talk';
export { ListenController } from './voice/listen-controller';
export type { ListenMic } from './voice/listen-controller';

/** "Scout, what's wrong?": what a host reads for the health card, and where Fix it lands. */
export type { FixTarget, HealthFacts } from './health';
