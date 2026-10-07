import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ContextSnapshot, Message, Pet, Settings } from '@tagalong/protocol';
import { Settings as SettingsSchema } from '@tagalong/protocol';
import {
  CONTEXT_LABELS,
  MAX_SELECTION_CHARS,
  MEMORY_HEADING,
  NOTES_HEADING,
  TRUNCATION_MARKER,
  assemblePrompt,
} from './prompt-assembler';
import { getRole } from '../roles';

const pet: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🐾',
  notes: 'You are Scout, a terse field guide.',
  model: 'claude-opus-5',
  providerId: 'anthropic',
  roleId: 'generalist',
  roleVersion: 1,
  toolGrants: {},
  replyStyle: 'text',
};

const settings: Settings = SettingsSchema.parse({});

function userMessage(text: string): Message {
  return {
    id: randomUUID(),
    conversationId: conversationId,
    role: 'user',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
  };
}

function assistantMessage(text: string): Message {
  return { ...userMessage(text), role: 'assistant' };
}

const conversationId = randomUUID();

function snapshotWithEverything(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    id: randomUUID(),
    capturedAt: new Date().toISOString(),
    host: 'extension',
    app: { name: 'chrome.exe', windowTitle: 'Zod docs - Chrome' },
    selection: 'the highlighted paragraph',
    page: { url: 'https://zod.dev/', title: 'Zod', text: 'page body text' },
    screenshot: { mime: 'image/png', base64: 'aGk=', width: 800, height: 600 },
    ...overrides,
  };
}

function lastText(request: ReturnType<typeof assemblePrompt>): string {
  const message = request.messages.at(-1);
  return (message?.content ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}

describe('assemblePrompt system prompt', () => {
  it('states the base rules, the role, the name, the notes, and the reply style', () => {
    const { system } = assemblePrompt({ pet, history: [userMessage('hi')], settings });

    expect(system).toContain('screen');
    expect(system.toLowerCase()).toContain('concise');
    expect(system).toMatch(/never claim/i);
    expect(system).toMatch(/clicked|typed/i);
    expect(system).toContain(getRole('generalist')!.instructions);
    expect(system).toContain('Your name is Scout.');
    expect(system).toContain(`${NOTES_HEADING}\n${pet.notes}`);
  });

  it('orders the role instructions, then the name, then the notes, then the reply style', () => {
    const { system } = assemblePrompt({
      pet: { ...pet, roleId: 'writer' },
      history: [userMessage('hi')],
      settings,
    });

    const role = system.indexOf(getRole('writer')!.instructions);
    const name = system.indexOf('Your name is Scout.');
    const notes = system.indexOf(NOTES_HEADING);
    const style = system.indexOf('Your reply is read on screen.');
    expect(system.indexOf('You are a Tagalong companion')).toBe(0);
    expect(role).toBeGreaterThan(0);
    expect(name).toBeGreaterThan(role);
    expect(notes).toBeGreaterThan(name);
    expect(style).toBeGreaterThan(notes);
  });

  it('leaves the notes section out when the pet has none or they are blank', () => {
    const { notes: _notes, ...plain } = pet;
    for (const subject of [plain, { ...pet, notes: '  ' }]) {
      const { system } = assemblePrompt({ pet: subject, history: [userMessage('hi')], settings });
      expect(system).not.toContain(NOTES_HEADING);
    }
  });

  it("falls back to the generalist's instructions for a role the library does not have", () => {
    const { system } = assemblePrompt({
      pet: { ...pet, roleId: 'astronaut' },
      history: [userMessage('hi')],
      settings,
    });
    expect(system).toContain(getRole('generalist')!.instructions);
  });

  it('swaps in the reply-style rule the pet asked for', () => {
    const spoken = assemblePrompt({
      pet: { ...pet, replyStyle: 'voice-full' },
      history: [userMessage('hi')],
      settings,
    });
    expect(spoken.system).toMatch(/spoken|aloud/i);
    expect(spoken.system).not.toBe(
      assemblePrompt({ pet, history: [userMessage('hi')], settings }).system,
    );
  });
});

describe('assemblePrompt memory section', () => {
  const memory = (text: string, overrides: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    scope: 'pet' as const,
    petId: 'scout',
    kind: 'preference' as const,
    text,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it('adds what the pet remembers to the system prompt, labelled by kind and scope', () => {
    const request = assemblePrompt({
      pet,
      history: [userMessage('hi')],
      settings,
      memories: [
        memory('Prefers short answers'),
        memory('The repo uses pnpm', { scope: 'crew', petId: null, kind: 'fact' }),
      ],
    });

    expect(request.system).toContain(MEMORY_HEADING);
    expect(request.system).toContain('- (preference) Prefers short answers');
    expect(request.system).toContain('- (fact, shared by the crew) The repo uses pnpm');
    // Remembered preferences outrank the generic style rule, so they come after it.
    expect(request.system.indexOf(MEMORY_HEADING)).toBeGreaterThan(
      request.system.indexOf('You are Scout'),
    );
  });

  it('keeps the section under the 2,000 character budget', () => {
    const many = Array.from({ length: 10 }, (_, i) => memory(`${i} ${'y'.repeat(300)}`));
    const request = assemblePrompt({ pet, history: [userMessage('hi')], settings, memories: many });

    const section = request.system.slice(request.system.indexOf(MEMORY_HEADING));
    expect(section.length).toBeLessThanOrEqual(2000);
    expect(section).toContain('0 yyy');
  });

  it('leaves the section out when there is nothing to remember', () => {
    const request = assemblePrompt({ pet, history: [userMessage('hi')], settings, memories: [] });

    expect(request.system).not.toContain(MEMORY_HEADING);
  });
});

describe('assemblePrompt context block', () => {
  it('orders the sections selection, page, window, screenshot', () => {
    const request = assemblePrompt({
      pet,
      history: [userMessage('what is this?')],
      snapshot: snapshotWithEverything(),
      settings,
    });
    const text = lastText(request);

    const order = [
      text.indexOf(CONTEXT_LABELS.selection),
      text.indexOf(CONTEXT_LABELS.page),
      text.indexOf(CONTEXT_LABELS.window),
      text.indexOf(CONTEXT_LABELS.screenshot),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('keeps the user question ahead of the context it was asked about', () => {
    const text = lastText(
      assemblePrompt({
        pet,
        history: [userMessage('what is this?')],
        snapshot: snapshotWithEverything(),
        settings,
      }),
    );
    expect(text.indexOf('what is this?')).toBeLessThan(text.indexOf(CONTEXT_LABELS.selection));
  });

  it('truncates page text at the settings budget and says so', () => {
    const budget = 100;
    const text = lastText(
      assemblePrompt({
        pet,
        history: [userMessage('summarise')],
        snapshot: snapshotWithEverything({
          page: { url: 'https://zod.dev/', title: 'Zod', text: 'p'.repeat(budget + 500) },
        }),
        settings: { ...settings, pageTextBudget: budget },
      }),
    );

    expect(text).toContain(`${'p'.repeat(budget)}${TRUNCATION_MARKER}`);
    expect(text).not.toContain('p'.repeat(budget + 1));
  });

  it('keeps a selection whole up to the selection ceiling', () => {
    const selection = 's'.repeat(MAX_SELECTION_CHARS);
    const text = lastText(
      assemblePrompt({
        pet,
        history: [userMessage('explain this')],
        snapshot: snapshotWithEverything({ selection, page: undefined }),
        settings: { ...settings, pageTextBudget: 10 },
      }),
    );

    expect(text).toContain(selection);
    expect(text).not.toContain(TRUNCATION_MARKER);
  });

  it('skips sections the snapshot does not carry', () => {
    const text = lastText(
      assemblePrompt({
        pet,
        history: [userMessage('hello')],
        snapshot: {
          id: randomUUID(),
          capturedAt: new Date().toISOString(),
          host: 'desktop',
          selection: 'just this',
        },
        settings,
      }),
    );

    expect(text).toContain(CONTEXT_LABELS.selection);
    expect(text).not.toContain(CONTEXT_LABELS.page);
    expect(text).not.toContain(CONTEXT_LABELS.window);
    expect(text).not.toContain(CONTEXT_LABELS.screenshot);
  });

  it('leaves the message untouched when there is no snapshot', () => {
    const request = assemblePrompt({ pet, history: [userMessage('hello')], settings });
    expect(request.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'hello' }]);
  });
});

describe('assemblePrompt vision rules', () => {
  it('tells the model to describe, quote exactly, and admit an unreadable image', () => {
    const { system } = assemblePrompt({ pet, history: [userMessage('hi')], settings });

    expect(system).toMatch(/describe what is visible before interpreting/i);
    expect(system).toMatch(/quote on-screen text exactly/i);
    expect(system).toMatch(/unreadable/i);
  });

  it('puts the image block ahead of every text block in the last user message', () => {
    const content =
      assemblePrompt({
        pet,
        history: [userMessage('what is this?')],
        snapshot: snapshotWithEverything(),
        settings,
      }).messages.at(-1)?.content ?? [];

    const firstImage = content.findIndex((block) => block.type === 'image');
    const firstText = content.findIndex((block) => block.type === 'text');
    expect(firstImage).toBe(0);
    expect(firstImage).toBeLessThan(firstText);
  });

  it('leads a context-only user message with the image', () => {
    const content =
      assemblePrompt({
        pet,
        history: [assistantMessage('still thinking')],
        snapshot: snapshotWithEverything(),
        settings,
      }).messages.at(-1)?.content ?? [];

    expect(content.at(0)?.type).toBe('image');
  });

  it('emits no image block when the snapshot carries no screenshot', () => {
    const content =
      assemblePrompt({
        pet,
        history: [userMessage('what is this?')],
        snapshot: snapshotWithEverything({ screenshot: undefined }),
        settings,
      }).messages.at(-1)?.content ?? [];

    expect(content.some((block) => block.type === 'image')).toBe(false);
    expect(content.at(0)).toEqual({ type: 'text', text: 'what is this?' });
  });
});

describe('assemblePrompt messages', () => {
  it('emits the screenshot as an image content block', () => {
    const request = assemblePrompt({
      pet,
      history: [userMessage('what is this?')],
      snapshot: snapshotWithEverything(),
      settings,
    });

    expect(request.messages.at(-1)?.content.at(0)).toEqual({
      type: 'image',
      mime: 'image/png',
      base64: 'aGk=',
    });
  });

  it('replays history in order and keeps roles', () => {
    const request = assemblePrompt({
      pet,
      history: [userMessage('first'), assistantMessage('answer'), userMessage('second')],
      settings,
    });

    expect(request.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(request.messages[0]?.content).toEqual([{ type: 'text', text: 'first' }]);
  });

  it('keeps only the last historyMessages entries', () => {
    const history = Array.from({ length: 8 }, (_, index) => userMessage(`m${index}`));
    const request = assemblePrompt({
      pet,
      history,
      settings: { ...settings, historyMessages: 3 },
    });

    expect(request.messages).toHaveLength(3);
    expect(lastText(request)).toContain('m7');
  });

  it('asks the model the pet is configured with', () => {
    const request = assemblePrompt({ pet, history: [userMessage('hi')], settings });
    expect(request.model).toBe('claude-opus-5');
    expect(request.maxTokens).toBeGreaterThan(0);
  });

  it('adds a user message when the context has nowhere else to go', () => {
    const request = assemblePrompt({
      pet,
      history: [assistantMessage('still thinking')],
      snapshot: snapshotWithEverything({ screenshot: undefined }),
      settings,
    });

    expect(request.messages.at(-1)?.role).toBe('user');
    expect(lastText(request)).toContain(CONTEXT_LABELS.selection);
  });
});

describe('assemblePrompt window inventory', () => {
  const windows = [
    {
      id: 'w-1',
      processName: 'Code.exe',
      title: 'runner.ts — tagalong',
      state: 'minimized' as const,
      displayId: 1,
      browser: false,
    },
    {
      id: 'w-2',
      processName: 'chrome.exe',
      title: 'Zod docs',
      state: 'foreground' as const,
      displayId: 1,
      browser: true,
    },
  ];

  it('attaches the inventory as text on a capture that carries one', () => {
    const request = assemblePrompt({
      pet,
      settings,
      history: [userMessage('what is open')],
      snapshot: snapshotWithEverything({ windows }),
    });

    expect(lastText(request)).toContain(CONTEXT_LABELS.windows);
    expect(lastText(request)).toContain('w-1');
    expect(lastText(request)).toContain('w-2');
  });

  it('says a window is minimized, which is the part the user cannot see', () => {
    const request = assemblePrompt({
      pet,
      settings,
      history: [userMessage('what is open')],
      snapshot: snapshotWithEverything({ windows }),
    });

    expect(lastText(request)).toContain('minimized');
  });

  it('carries no window text, only the list', () => {
    // The whole cost argument: the inventory is cheap because it says what is open, not
    // what is in it. The pet spends a tool call on the one window it wants.
    const request = assemblePrompt({
      pet,
      settings,
      history: [userMessage('what is open')],
      snapshot: snapshotWithEverything({ windows }),
    });

    expect(lastText(request)).toContain('read_window_text');
  });

  it('leaves the section out entirely when no inventory was captured', () => {
    const request = assemblePrompt({
      pet,
      settings,
      history: [userMessage('hello')],
      snapshot: snapshotWithEverything(),
    });

    expect(lastText(request)).not.toContain(CONTEXT_LABELS.windows);
  });

  it('leaves the section out for an empty inventory rather than saying nothing is open', () => {
    // An empty list means the enumeration failed or was not asked for, not that the
    // desktop is empty. Telling the pet "no windows are open" would be a lie it would
    // then reason from.
    const request = assemblePrompt({
      pet,
      settings,
      history: [userMessage('hello')],
      snapshot: snapshotWithEverything({ windows: [] }),
    });

    expect(lastText(request)).not.toContain(CONTEXT_LABELS.windows);
  });
});

// ---------------------------------------------------------------------------
// Phase 2B: the full-view attach policy
// ---------------------------------------------------------------------------

const PNG = { mime: 'image/png', base64: 'aGk=', width: 1568, height: 882 } as const;

function display(
  id: number,
  overrides: Partial<{
    focused: boolean;
    primary: boolean;
    width: number;
    height: number;
    image: typeof PNG | undefined;
    blocked: { rule: 'processName' | 'titlePattern'; entry: string };
  }> = {},
) {
  const { focused = false, primary = false, width = 1920, height = 1080 } = overrides;
  return {
    id,
    bounds: { x: 0, y: 0, width, height },
    scaleFactor: 1,
    primary,
    focused,
    ...('image' in overrides ? { image: overrides.image } : { image: PNG }),
    ...(overrides.blocked === undefined ? {} : { blocked: overrides.blocked }),
  };
}

function fullView(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    id: randomUUID(),
    capturedAt: new Date().toISOString(),
    host: 'desktop',
    composite: PNG,
    displays: [
      display(101, { focused: true, primary: true }),
      display(102),
      display(103, { width: 2560, height: 1440 }),
    ],
    ...overrides,
  } as ContextSnapshot;
}

function imagesOf(request: ReturnType<typeof assemblePrompt>): number {
  const last = request.messages.at(-1);
  return (last?.content ?? []).filter((block) => block.type === 'image').length;
}

function textOf(request: ReturnType<typeof assemblePrompt>): string {
  const last = request.messages.at(-1);
  return (last?.content ?? [])
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

describe('the full-view attach policy', () => {
  it('attaches the composite and the focused display, and nothing else', () => {
    // The whole cost argument of this phase: three monitors must not mean three images
    // on every ask. The composite is the map; the focused display is where the user is.
    const request = assemblePrompt({
      pet,
      history: [userMessage('what is on my screens')],
      snapshot: fullView(),
      settings,
    });

    expect(imagesOf(request)).toBe(2);
  });

  it('attaches every display when sightDetail is all', () => {
    const request = assemblePrompt({
      pet,
      history: [userMessage('what is on my screens')],
      snapshot: fullView(),
      settings: SettingsSchema.parse({ sightDetail: 'all' }),
    });

    // Composite plus three displays.
    expect(imagesOf(request)).toBe(4);
  });

  it('lists the displays it did not attach, with their ids and sizes', () => {
    const text = textOf(
      assemblePrompt({
        pet,
        history: [userMessage('what is on my right monitor')],
        snapshot: fullView(),
        settings,
      }),
    );

    expect(text).toContain('102');
    expect(text).toContain('103');
    expect(text).toContain('2560');
    expect(text).toContain('1440');
  });

  it('maps each composite label to the display id a tool call needs', () => {
    // The composite draws ordinals in its corners because a ten-digit Electron id costs
    // seven glyphs of a five-pixel font. look_at_display takes the id. Without the
    // mapping in the text, the pet can see "2" and has no way to ask for it.
    const text = textOf(
      assemblePrompt({
        pet,
        history: [userMessage('look at screen two')],
        snapshot: fullView(),
        settings,
      }),
    );

    expect(text).toMatch(/\b1\b[^\n]*101/);
    expect(text).toMatch(/\b2\b[^\n]*102/);
    expect(text).toMatch(/\b3\b[^\n]*103/);
  });

  it('says which display is the focused one', () => {
    const text = textOf(
      assemblePrompt({
        pet,
        history: [userMessage('what am I working on')],
        snapshot: fullView(),
        settings,
      }),
    );

    expect(text).toMatch(/101[^\n]*focused/);
  });

  it('names the exclusion that blanked a display rather than calling it empty', () => {
    const text = textOf(
      assemblePrompt({
        pet,
        history: [userMessage('what is on screen three')],
        snapshot: fullView({
          displays: [
            display(101, { focused: true, primary: true }),
            display(102),
            display(103, { blocked: { rule: 'processName', entry: '1Password.exe' } }),
          ],
        }),
        settings,
      }),
    );

    expect(text).toContain('1Password.exe');
  });

  it('does not attach a display the capturer could not read', () => {
    const request = assemblePrompt({
      pet,
      history: [userMessage('what is on my screens')],
      snapshot: fullView({
        displays: [display(101, { focused: true, image: undefined }), display(102)],
      }),
      settings: SettingsSchema.parse({ sightDetail: 'all' }),
    });

    // Composite plus the one display that has pixels. A missing image must not become an
    // empty image block, which providers reject.
    expect(imagesOf(request)).toBe(2);
  });

  it('still attaches the composite when no display is focused', () => {
    // Windows reports no foreground window often enough to matter: a locked session, a
    // UAC prompt, a full-screen game. The map is still worth sending.
    const request = assemblePrompt({
      pet,
      history: [userMessage('what is on my screens')],
      snapshot: fullView({ displays: [display(101), display(102)] }),
      settings,
    });

    expect(imagesOf(request)).toBe(1);
  });

  it('leaves a Phase 2 single-screenshot snapshot exactly as it was', () => {
    // Phase 2's Ctrl+Shift+S path must not change shape because Phase 2B exists.
    const request = assemblePrompt({
      pet,
      history: [userMessage('what is wrong here')],
      snapshot: {
        id: randomUUID(),
        capturedAt: new Date().toISOString(),
        host: 'desktop',
        screenshot: PNG,
      } as ContextSnapshot,
      settings,
    });

    expect(imagesOf(request)).toBe(1);
    expect(textOf(request)).toContain(CONTEXT_LABELS.screenshot);
  });

  it('keeps the task 3 window inventory attached alongside the displays', () => {
    const text = textOf(
      assemblePrompt({
        pet,
        history: [userMessage('where should this go')],
        snapshot: fullView({
          windows: [
            {
              id: 'w-1',
              processName: 'Code.exe',
              title: 'displays.ts',
              state: 'background',
              browser: false,
              displayId: 102,
            },
          ],
        }),
        settings,
      }),
    );

    expect(text).toContain(CONTEXT_LABELS.windows);
    expect(text).toContain('w-1');
  });
});
