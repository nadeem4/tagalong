import type {
  ContextSnapshot,
  Message,
  MessageContent,
  Pet,
  ReplyStyle,
  Settings,
} from '@tagalong/protocol';
import { MAX_SELECTION_CHARS } from '@tagalong/protocol';
import type { BrainContent, BrainMessage, BrainRequest } from '../providers';
import { renderInventory } from '../perception/inventory';

export { MAX_SELECTION_CHARS };

/**
 * Ceiling on a single answer. Generous enough for an explanation with a code block,
 * small enough that a runaway reply cannot burn a whole rate limit window.
 */
export const MAX_OUTPUT_TOKENS = 2048;

/** Appended wherever text was cut, so the model never mistakes a stub for the whole thing. */
export const TRUNCATION_MARKER = '… [truncated]';

/** Section headings, exported because tests and the host both reason about the order. */
export const CONTEXT_LABELS = {
  selection: 'Selected text',
  page: 'Page text',
  window: 'Active window',
  screenshot: 'Screenshot',
  windows: 'Open windows',
  displays: 'Displays',
} as const;

/**
 * The rules that make Tagalong Tagalong rather than a chat window. The last line is
 * the safety one: the pet can look but never act, and a model that narrates fake
 * clicks teaches the user to trust something that never happened.
 */
const BASE_INSTRUCTIONS = [
  'You are a Tagalong companion: a small character living on the edge of the screen.',
  'The user shares what they are looking at with you — selected text, page text, the active window, sometimes a screenshot.',
  'Answer about what is on screen first, and only then about anything else.',
  'Be concise. A couple of sentences unless the user asks for depth.',
  'Say so plainly when the context does not contain the answer.',
  'With a screenshot, describe what is visible before interpreting it.',
  'Quote on-screen text exactly when asked; never paraphrase it as a quote.',
  'Say plainly when the image is unreadable rather than guessing at it.',
  'You can only look and talk. You never click, type, or change anything on the machine, and you must never claim to have clicked or typed anything.',
].join('\n');

const REPLY_STYLE_RULES: Record<ReplyStyle, string> = {
  text: 'Your reply is read on screen. Short paragraphs, lists, and code fences are fine.',
  'voice-summary':
    'Your reply is spoken aloud as a summary. Open with one or two sentences that stand on their own without any formatting.',
  'voice-full':
    'Your reply is spoken aloud in full. Write plain sentences: no markdown, no lists, no code fences.',
};

export interface AssembleInput {
  pet: Pet;
  /** Oldest first, ending with the question being asked. Trimmed to `historyMessages`. */
  history: Message[];
  snapshot?: ContextSnapshot | undefined;
  settings: Settings;
}

/** Builds the provider-neutral request for one turn. Pure: no clock, no store, no IO. */
export function assemblePrompt(input: AssembleInput): BrainRequest {
  const { pet, settings } = input;
  const history = input.history.slice(-settings.historyMessages);
  const messages = history.map(toBrainMessage);

  const contextText = input.snapshot ? contextBlock(input.snapshot, settings) : '';
  const leading = input.snapshot ? imagesToAttach(input.snapshot, settings) : [];

  if (contextText || leading.length > 0) {
    const trailing: BrainContent[] = contextText ? [{ type: 'text', text: contextText }] : [];
    attachToLastUserMessage(messages, leading, trailing);
  }

  return {
    model: pet.model,
    ...(pet.visionModel === undefined ? {} : { visionModel: pet.visionModel }),
    system: systemPrompt(pet),
    messages,
    maxTokens: MAX_OUTPUT_TOKENS,
  };
}

/**
 * Which pictures ride along with the question.
 *
 * Phase 2's single screenshot is unchanged. A full-view capture sends the composite —
 * the map of how the monitors sit — plus the display the user is actually working on,
 * and names the rest in text for the pet to fetch by tool. Three monitors must not mean
 * three images on every ask; that is the whole cost argument of this phase.
 *
 * `sightDetail: 'all'` overrides it for someone who would rather pay than ask twice.
 *
 * A display with no `image` is skipped everywhere. The capturer returns no source for a
 * screen it was not allowed to read, and an absent image must not become an empty image
 * block, which providers reject outright.
 */
function imagesToAttach(snapshot: ContextSnapshot, settings: Settings): BrainContent[] {
  const images: BrainContent[] = [];
  const add = (image: { mime: 'image/png'; base64: string }): void => {
    images.push({ type: 'image', mime: image.mime, base64: image.base64 });
  };

  if (snapshot.screenshot) add(snapshot.screenshot);
  // The composite leads the displays: it is the map, and a reader makes sense of one
  // screen faster having already seen where that screen sits.
  if (snapshot.composite) add(snapshot.composite);

  for (const display of snapshot.displays ?? []) {
    if (display.image === undefined) continue;
    if (settings.sightDetail === 'all' || display.focused) add(display.image);
  }

  return images;
}

function systemPrompt(pet: Pet): string {
  return [BASE_INSTRUCTIONS, pet.persona.trim(), REPLY_STYLE_RULES[pet.replyStyle]]
    .filter((part) => part.length > 0)
    .join('\n\n');
}

/**
 * Context is attached to the user's own message rather than sent as its own turn:
 * the model reads it as "here is what I was looking at when I asked", and the
 * volatile part of the prompt stays behind the cacheable system block.
 *
 * The screenshot leads and the text context trails, because a model answers about a
 * picture far more reliably when it has seen the picture before reading the question.
 */
function attachToLastUserMessage(
  messages: BrainMessage[],
  leading: BrainContent[],
  trailing: BrainContent[],
): void {
  const last = messages.at(-1);
  if (last?.role === 'user') {
    last.content = [...leading, ...last.content, ...trailing];
    return;
  }
  messages.push({ role: 'user', content: [...leading, ...trailing] });
}

/** Selection, page, window, screenshot, then everything else that is open. */
function contextBlock(snapshot: ContextSnapshot, settings: Settings): string {
  const sections: string[] = [];

  if (snapshot.selection) {
    sections.push(
      section(CONTEXT_LABELS.selection, truncate(snapshot.selection, MAX_SELECTION_CHARS)),
    );
  }

  if (snapshot.page) {
    const heading = `${CONTEXT_LABELS.page} — ${snapshot.page.title} (${snapshot.page.url})`;
    sections.push(section(heading, truncate(snapshot.page.text, settings.pageTextBudget)));
  }

  if (snapshot.app) {
    const title = snapshot.app.windowTitle ? ` — ${snapshot.app.windowTitle}` : '';
    sections.push(section(CONTEXT_LABELS.window, `${snapshot.app.name}${title}`));
  }

  if (snapshot.screenshot) {
    sections.push(
      section(CONTEXT_LABELS.screenshot, 'Attached as an image alongside this message.'),
    );
  }

  if (snapshot.displays && snapshot.displays.length > 0) {
    sections.push(section(CONTEXT_LABELS.displays, renderDisplays(snapshot, settings.sightDetail)));
  }

  // Omitted when empty rather than rendered as "no windows are open". An empty list means
  // the enumeration failed or was never asked for, and a pet told the desktop is empty
  // will reason from that as though it were observed.
  if (snapshot.windows && snapshot.windows.length > 0) {
    sections.push(section(CONTEXT_LABELS.windows, renderInventory(snapshot.windows)));
  }

  return sections.length > 0 ? ['--- Screen context ---', ...sections].join('\n\n') : '';
}

/**
 * The displays as lines the pet can act on.
 *
 * The ordinal comes first because that is what the composite draws in each corner — a
 * ten-digit Electron id would cost seven glyphs of a five-pixel font and be unreadable at
 * composite scale. The id comes second because `look_at_display` takes the id. Printing
 * one without the other leaves the pet able to see a screen it cannot name, or name one
 * it cannot see, so the mapping is the point of this block.
 */
function renderDisplays(snapshot: ContextSnapshot, detail: Settings['sightDetail']): string {
  const displays = snapshot.displays ?? [];
  const attachedAll = detail === 'all';

  const lines = displays.map((display, index) => {
    const ordinal = index + 1;
    const size = `${display.bounds.width}x${display.bounds.height}`;
    const marks = [
      display.focused ? 'focused' : '',
      display.primary ? 'primary' : '',
      ...appsOn(snapshot, display.id),
    ].filter((mark) => mark.length > 0);

    if (display.blocked !== undefined) {
      // Named rather than called empty: a pet shown a grey rectangle with no explanation
      // will guess what was behind it, and the guess is about a window the user asked
      // Tagalong never to look at.
      return `${ordinal} id=${display.id} ${size} blocked by ${display.blocked.entry}`;
    }

    const attached =
      display.image === undefined
        ? 'not captured'
        : attachedAll || display.focused
          ? 'attached as an image'
          : 'not attached — look_at_display to see it';

    return `${ordinal} id=${display.id} ${size}${marks.length > 0 ? ` ${marks.join(' ')}` : ''} — ${attached}`;
  });

  return [
    `${displays.length} display${displays.length === 1 ? '' : 's'}. The composite image is ` +
      'labelled with each number below in its corner; look_at_display takes the id.',
    ...lines,
  ].join('\n');
}

/**
 * Which applications are on a display, from the window inventory when there is one.
 *
 * The phase page asks for the "focused app" of each display, which Windows cannot answer:
 * there is one foreground window for the whole desktop, so an unfocused display has no
 * focused app. Naming what is open on it instead answers the question the user actually
 * has — which screen holds the thing I mean — using data already in the snapshot.
 */
function appsOn(snapshot: ContextSnapshot, displayId: number): string[] {
  const names = new Set<string>();
  for (const window of snapshot.windows ?? []) {
    if (window.displayId !== displayId) continue;
    if (window.state === 'minimized') continue;
    if (window.blocked !== undefined) continue;
    names.add(window.processName.replace(/\.exe$/i, ''));
    if (names.size >= MAX_APPS_PER_DISPLAY) break;
  }
  return names.size === 0 ? [] : [[...names].join(',')];
}

/**
 * How many application names a display line carries.
 *
 * Two, because the budget is shared across every display and the line is a hint about
 * where to look rather than an inventory — the window list already carries that in full.
 */
const MAX_APPS_PER_DISPLAY = 2;

function section(heading: string, body: string): string {
  return `## ${heading}\n${body}`;
}

function truncate(text: string, budget: number): string {
  return text.length <= budget ? text : `${text.slice(0, budget)}${TRUNCATION_MARKER}`;
}

/**
 * Stored content and provider content are the same shape, but the stored union's
 * `input` is optional, so the blocks are rebuilt field by field rather than cast.
 */
function toBrainMessage(message: Message): BrainMessage {
  return { role: message.role, content: message.content.map(toBrainContent) };
}

function toBrainContent(block: MessageContent): BrainContent {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return { type: 'image', mime: block.mime, base64: block.base64 };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        toolUseId: block.toolUseId,
        content: block.content,
        ...(block.isError === undefined ? {} : { isError: block.isError }),
      };
  }
}
