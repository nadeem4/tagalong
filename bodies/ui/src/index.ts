/**
 * The public surface of @tagalong/ui: React components and helpers shared by the desktop
 * renderer. Contains the HostBridge contract and its provider, the bubble, dock pet, Home,
 * the Settings styles, Scout's voice helpers and the fake bridge for host tests. Never imports electron or opens a socket: hosts hand it a
 * HostBridge.
 */
export { HostBridgeProvider, useHostBridge } from './host-bridge';
export type {
  AskInput,
  BrainLink,
  HostBridge,
  JobRow,
  ApprovalRow,
  ApprovalCounts,
  PreferenceRow,
  PermissionRow,
  SpendToday,
  KeyStatus,
  KeyResult,
  ExpertStatus,
} from './host-bridge';

export { CompanionBubble, GreetingLine } from './companion-bubble';
export { ApprovedReport } from './approved-card';
export type { DropOffer } from './drop-card';
export { DockPet } from './dock-pet';
export type { BeanFigure, DockMood, DockPetProps, ListeningDot } from './dock-pet';
export { BeanClip } from './theme/bean-clip';
export type { BeanClipData } from './theme/bean-clip';
export type { BubbleTalk, CompanionBubbleProps, GreetingLineProps } from './companion-bubble';

/** Exported so hosts can test their renderer wiring without booting a brain. */
export { createFakeHostBridge } from './test-support/fake-host-bridge';

/** Home: the one window for jobs, permissions, approvals, connections, memory and settings. */
export { HomeView } from './home/home-view';
export type { HomeHost, HomePage, HomeViewProps } from './home/home-view';

export { SETTINGS_CSS } from './settings/settings-styles';

/** The Anthropic key field and the daily-limit field, shared by Settings and the walkthrough. */
export { KeyField, LimitField } from './key/key-field';
export { useKeyStatus } from './key/use-key-status';
export type { KeyHost } from './key/use-key-status';

/** Talk to Scout: telling a held key from a fresh press, and the bubble's side of it. */
export { PushToTalk } from './voice/push-to-talk';
export type { TalkAction } from './voice/push-to-talk';
export { ListenController } from './voice/listen-controller';
export type { ListenMic } from './voice/listen-controller';

/** "Scout, what's wrong?": what a host reads for the health card, and where Fix it lands. */
export type { HealthFacts } from './health';

/** The first-run walkthrough window's content. */
export { Walkthrough } from './walkthrough/walkthrough';
export type { VoicePreview, WalkthroughHost, WalkthroughSettings } from './walkthrough/walkthrough-host';
