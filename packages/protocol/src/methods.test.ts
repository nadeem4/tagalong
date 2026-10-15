import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_TEXT_CHARS,
  HostCapability,
  MAX_WINDOW_TEXT_CHARS,
  PerceptionCaptureRegionParams,
  PerceptionCaptureWindowParams,
  PerceptionCaptureWindowResult,
  PerceptionCaptureRegionResult,
  PerceptionListWindowsParams,
  PerceptionListWindowsResult,
  PerceptionReadTextParams,
  PerceptionReadTextResult,
  ScreenPointAtParams,
  ScreenPointAtResult,
  coreToHostMethods,
  coreToHostNotifications,
  hostToCoreMethods,
  notificationParamsSchemaFor,
  paramsSchemaFor,
  resultSchemaFor,
} from './methods';

/** Every row of the Phase 1 method table, by direction. */
const HOST_TO_CORE = [
  'hello',
  'ask',
  'interrupt',
  'pets.list',
  'pets.upsert',
  'settings.get',
  'settings.set',
  'models.list',
  'providers.check',
  'tool.approve',
  'watch.stop',
  'activity.list',
  'experts.list',
  'experts.upsert',
  'experts.delete',
  'experts.test',
  'handoffs.cancel',
  'handoffs.confirm',
  'handoffs.dismiss',
  'projects.search',
  'greeting.compose',
  'keepAnEye.observe',
  'keepAnEye.notNow',
  'keepAnEye.accept',
  'connections.list',
  'connections.add',
  'connections.setEnabled',
  'connections.signIn',
  'connections.remove',
  'routines.list',
  'routines.save',
  'routines.delete',
  'routines.setEnabled',
  'routines.runNow',
  'routines.confirm',
  'routines.dismiss',
] as const;

const CORE_TO_HOST = ['perception.capture'] as const;

const CORE_TO_HOST_NOTIFICATIONS = [
  'turn.started',
  'turn.delta',
  'turn.toolRequest',
  'turn.toolResult',
  'turn.completed',
  'turn.error',
  'turn.warning',
  'watch.fired',
  'watch.status',
  'handoff.proposed',
  'handoff.progress',
  'handoff.finished',
  'pet.remark',
  'connections.changed',
  'connector.confirm',
  'routine.proposed',
  'routine.result',
  'routines.changed',
  'pet.mood',
] as const;

describe('method catalog', () => {
  it.each(HOST_TO_CORE)('host-to-core %s has params and result schemas', (method) => {
    expect(hostToCoreMethods[method].params).toBeDefined();
    expect(hostToCoreMethods[method].result).toBeDefined();
  });

  it.each(CORE_TO_HOST)('core-to-host %s has params and result schemas', (method) => {
    expect(coreToHostMethods[method].params).toBeDefined();
    expect(coreToHostMethods[method].result).toBeDefined();
  });

  it.each(CORE_TO_HOST_NOTIFICATIONS)('notification %s has a params schema', (method) => {
    expect(coreToHostNotifications[method].params).toBeDefined();
  });

  it('covers the table exactly, with no extra methods', () => {
    expect(Object.keys(hostToCoreMethods).sort()).toEqual([...HOST_TO_CORE].sort());
    expect(Object.keys(coreToHostNotifications).sort()).toEqual(
      [...CORE_TO_HOST_NOTIFICATIONS].sort(),
    );
  });
});

describe('pet.mood', () => {
  it('carries a wince or a cheer for one pet, and nothing else', () => {
    const wince = { petId: 'scout', mood: 'wince' };
    expect(notificationParamsSchemaFor('pet.mood').parse(wince)).toEqual(wince);
    expect(notificationParamsSchemaFor('pet.mood').parse({ ...wince, mood: 'cheer' })).toEqual({
      petId: 'scout',
      mood: 'cheer',
    });
    expect(
      notificationParamsSchemaFor('pet.mood').safeParse({ ...wince, mood: 'dozing' }).success,
    ).toBe(false);
    expect(notificationParamsSchemaFor('pet.mood').safeParse({ mood: 'wince' }).success).toBe(
      false,
    );
  });
});

describe('keep an eye', () => {
  const remarkId = '11111111-2222-4333-8444-555555555555';
  const window = {
    id: 'w-1',
    processName: 'Code.exe',
    title: 'build failed',
    state: 'foreground',
    browser: false,
    fullScreen: true,
  };

  it('takes a window list from the host, full-screen flag included', () => {
    expect(paramsSchemaFor('keepAnEye.observe').parse({ windows: [window] })).toEqual({
      windows: [window],
    });
  });

  it('carries one line to say, and an offer only when there is one', () => {
    const line = { remarkId, petId: 'scout', text: 'That test failed on a typo.' };
    expect(notificationParamsSchemaFor('pet.remark').parse(line)).toEqual(line);
    const offered = { ...line, offer: 'Fix the typo in parser.ts' };
    expect(notificationParamsSchemaFor('pet.remark').parse(offered)).toEqual(offered);
    const empty = { ...line, text: '' };
    expect(notificationParamsSchemaFor('pet.remark').safeParse(empty).success).toBe(false);
  });

  it('quiets for a while on Not now, and accepts an offer by its remark', () => {
    expect(paramsSchemaFor('keepAnEye.notNow').parse({})).toEqual({});
    expect(paramsSchemaFor('keepAnEye.accept').parse({ remarkId })).toEqual({ remarkId });
    expect(resultSchemaFor('keepAnEye.accept').parse({ proposed: true })).toEqual({
      proposed: true,
    });
  });
});

describe('schema lookup helpers', () => {
  it('validates hello params through the catalog', () => {
    const parsed = paramsSchemaFor('hello').parse({
      host: 'desktop',
      version: '0.0.0',
      capabilities: ['selection', 'activeWindow'],
      token: 'abc123',
    });
    expect(parsed.host).toBe('desktop');
  });

  it('rejects hello params missing the pairing token', () => {
    const bad = { host: 'desktop', version: '0.0.0', capabilities: [] };
    expect(paramsSchemaFor('hello').safeParse(bad).success).toBe(false);
  });

  it('validates an ask result through the catalog', () => {
    const turnId = '11111111-2222-4333-8444-555555555555';
    expect(resultSchemaFor('ask').parse({ turnId }).turnId).toBe(turnId);
  });

  it('rejects an unknown host capability', () => {
    const bad = { host: 'desktop', version: '0.0.0', capabilities: ['mind-reading'], token: 'x' };
    expect(paramsSchemaFor('hello').safeParse(bad).success).toBe(false);
  });
});

describe('greeting.compose', () => {
  it('names the pet that says hello, and returns one line and where it came from', () => {
    expect(paramsSchemaFor('greeting.compose').parse({ petId: 'scout' })).toEqual({
      petId: 'scout',
    });
    const line = { text: 'Morning. I’m here when you need me.', source: 'fallback' };
    expect(resultSchemaFor('greeting.compose').parse(line)).toEqual(line);
  });

  it('refuses an empty line', () => {
    expect(
      resultSchemaFor('greeting.compose').safeParse({ text: '', source: 'model' }).success,
    ).toBe(false);
  });

  it('carries what main recorded about the last launch, when it has it', () => {
    const launch = {
      crashed: true,
      lastVersion: '0.3.0',
      version: '0.4.0',
      whatsNew: 'Setup by voice.',
    };
    expect(paramsSchemaFor('greeting.compose').parse({ petId: 'scout', launch })).toEqual({
      petId: 'scout',
      launch,
    });
    expect(
      paramsSchemaFor('greeting.compose').parse({
        petId: 'scout',
        launch: { ...launch, lastVersion: null },
      }),
    ).toEqual({ petId: 'scout', launch: { ...launch, lastVersion: null } });
    expect(
      paramsSchemaFor('greeting.compose').safeParse({
        petId: 'scout',
        launch: { ...launch, version: '' },
      }).success,
    ).toBe(false);
  });
});

describe('ask input', () => {
  const turnId = '11111111-2222-4333-8444-555555555555';

  it('accepts a text-only ask', () => {
    const parsed = paramsSchemaFor('ask').parse({
      petId: 'scout',
      input: { text: 'explain this' },
    });
    expect(parsed.petId).toBe('scout');
  });

  it('accepts an audio-only ask', () => {
    const params = { petId: 'scout', input: { audio: { mime: 'audio/webm', base64: 'aGk=' } } };
    expect(paramsSchemaFor('ask').safeParse(params).success).toBe(true);
  });

  it('rejects an ask with neither text nor audio', () => {
    expect(paramsSchemaFor('ask').safeParse({ petId: 'scout', input: {} }).success).toBe(false);
  });

  it('marks a spoken ask, and leaves a typed one unmarked', () => {
    const spoken = paramsSchemaFor('ask').parse({
      petId: 'scout',
      input: { text: 'what is this' },
      spoken: true,
    });
    expect(spoken.spoken).toBe(true);
    const typed = paramsSchemaFor('ask').parse({ petId: 'scout', input: { text: 'hi' } });
    expect(typed.spoken).toBeUndefined();
  });

  it('rejects an ask with no pet', () => {
    expect(paramsSchemaFor('ask').safeParse({ input: { text: 'hi' } }).success).toBe(false);
  });

  it('rejects a non-uuid conversation id', () => {
    const params = { petId: 'scout', conversationId: 'nope', input: { text: 'hi' } };
    expect(paramsSchemaFor('ask').safeParse(params).success).toBe(false);
  });

  it('rejects a non-uuid turn id in the interrupt result path', () => {
    expect(paramsSchemaFor('interrupt').safeParse({ turnId: 'nope' }).success).toBe(false);
    expect(paramsSchemaFor('interrupt').safeParse({ turnId }).success).toBe(true);
  });
});

describe('notification schemas', () => {
  const turnId = '11111111-2222-4333-8444-555555555555';

  it('validates a turn.delta payload', () => {
    const parsed = notificationParamsSchemaFor('turn.delta').parse({ turnId, text: 'hello' });
    expect(parsed.text).toBe('hello');
  });

  it('validates a turn.completed payload', () => {
    const parsed = notificationParamsSchemaFor('turn.completed').parse({
      turnId,
      text: 'done',
      stopReason: 'end',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(parsed.stopReason).toBe('end');
  });

  it('rejects an unknown stop reason', () => {
    const bad = {
      turnId,
      text: '',
      stopReason: 'bored',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    expect(notificationParamsSchemaFor('turn.completed').safeParse(bad).success).toBe(false);
  });

  it('rejects negative token usage', () => {
    const bad = {
      turnId,
      text: '',
      stopReason: 'end',
      usage: { inputTokens: -1, outputTokens: 0 },
    };
    expect(notificationParamsSchemaFor('turn.completed').safeParse(bad).success).toBe(false);
  });

  it('validates a turn.warning payload', () => {
    const parsed = notificationParamsSchemaFor('turn.warning').parse({
      turnId,
      code: 'vision_unsupported',
      message: 'This pet cannot see images, so the screenshot was not sent.',
    });
    expect(parsed.code).toBe('vision_unsupported');
  });

  it('rejects a turn.warning without a code, so no host has to guess why', () => {
    const bad = { turnId, message: 'something happened' };
    expect(notificationParamsSchemaFor('turn.warning').safeParse(bad).success).toBe(false);
  });

  it('carries who said what and on which model in turn.started', () => {
    const parsed = notificationParamsSchemaFor('turn.started').parse({
      turnId,
      petId: 'ink',
      conversationId: turnId,
      providerId: 'openrouter',
      model: 'anthropic/claude-sonnet-5',
    });
    expect(parsed.model).toBe('anthropic/claude-sonnet-5');
    expect(parsed.providerId).toBe('openrouter');
  });

  it('counts model calls on turn.completed when the engine knows them', () => {
    const parsed = notificationParamsSchemaFor('turn.completed').parse({
      turnId,
      text: 'done',
      stopReason: 'end',
      usage: { inputTokens: 1, outputTokens: 1 },
      modelCalls: 3,
    });
    expect(parsed.modelCalls).toBe(3);
  });
});

describe('tool.approve', () => {
  const approvalId = '11111111-2222-4333-8444-555555555555';

  it('takes once or deny, and refuses the never-offered always', () => {
    expect(paramsSchemaFor('tool.approve').parse({ approvalId, decision: 'once' }).decision).toBe(
      'once',
    );
    expect(paramsSchemaFor('tool.approve').parse({ approvalId, decision: 'deny' }).decision).toBe(
      'deny',
    );
    expect(
      paramsSchemaFor('tool.approve').safeParse({ approvalId, decision: 'always' }).success,
    ).toBe(false);
  });
});

describe('perception.capture', () => {
  it('accepts a list of capture targets', () => {
    const parsed = coreToHostMethods['perception.capture'].params.parse({
      what: ['selection', 'activeWindow'],
    });
    expect(parsed.what).toEqual(['selection', 'activeWindow']);
  });

  it('rejects an empty capture request', () => {
    expect(coreToHostMethods['perception.capture'].params.safeParse({ what: [] }).success).toBe(
      false,
    );
  });

  it('rejects an unknown capture target', () => {
    const bad = { what: ['aura'] };
    expect(coreToHostMethods['perception.capture'].params.safeParse(bad).success).toBe(false);
  });

  it('returns a partial snapshot', () => {
    const parsed = coreToHostMethods['perception.capture'].result.parse({
      snapshot: { selection: 'just the selection' },
    });
    expect(parsed.snapshot.selection).toBe('just the selection');
  });
});

// ---------------------------------------------------------------------------
// Phase 2B: full view
// ---------------------------------------------------------------------------

describe('HostCapability, full view', () => {
  it('knows the two new capabilities', () => {
    expect(HostCapability.safeParse('displays').success).toBe(true);
    expect(HostCapability.safeParse('textLayer').success).toBe(true);
  });

  it('still knows every capability a Phase 1 host advertises', () => {
    for (const capability of ['selection', 'screenshot', 'activeWindow', 'clipboard', 'pageText']) {
      expect(HostCapability.safeParse(capability).success, capability).toBe(true);
    }
  });
});

describe('the core-to-host catalog after 3B', () => {
  it('carries the 2B perception methods plus recall and diff', () => {
    expect(Object.keys(coreToHostMethods).sort()).toEqual([
      'perception.capture',
      'perception.captureRegion',
      'perception.captureWindow',
      'perception.diff',
      'perception.listWindows',
      'perception.readText',
      'perception.recall',
      'screen.pointAt',
    ]);
  });
});

describe('perception.captureRegion', () => {
  const valid = {
    displayId: 2528732444,
    rect: { x: 100, y: 200, width: 640, height: 480 },
    maxLongSide: 1568,
  };

  it('parses a crop request', () => {
    expect(PerceptionCaptureRegionParams.parse(valid).rect.width).toBe(640);
  });

  it('accepts a negative origin, because display coordinates can be negative', () => {
    expect(
      PerceptionCaptureRegionParams.safeParse({ ...valid, rect: { ...valid.rect, x: -1800 } })
        .success,
    ).toBe(true);
  });

  it('rejects a rectangle with no area', () => {
    expect(
      PerceptionCaptureRegionParams.safeParse({ ...valid, rect: { ...valid.rect, height: 0 } })
        .success,
    ).toBe(false);
  });

  it('rejects a maxLongSide of zero', () => {
    expect(PerceptionCaptureRegionParams.safeParse({ ...valid, maxLongSide: 0 }).success).toBe(
      false,
    );
  });

  it('returns one image', () => {
    const parsed = PerceptionCaptureRegionResult.parse({
      image: { mime: 'image/png', base64: 'aGk=', width: 640, height: 480 },
    });
    expect(parsed.image.width).toBe(640);
  });
});

describe('perception.listWindows', () => {
  it('takes no parameters, because the inventory is the whole answer', () => {
    expect(PerceptionListWindowsParams.safeParse({}).success).toBe(true);
  });

  it('returns an array of entries and accepts an empty one', () => {
    expect(PerceptionListWindowsResult.parse({ windows: [] }).windows).toEqual([]);
    expect(
      PerceptionListWindowsResult.safeParse({
        windows: [
          {
            id: 'w-1',
            processName: 'Code.exe',
            title: 'a',
            state: 'minimized',
            browser: false,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('may name the screens in host order, so windows can be grouped by screen number', () => {
    const parsed = PerceptionListWindowsResult.parse({
      windows: [],
      displays: [
        { id: 2528732444, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true },
      ],
    });
    expect(parsed.displays?.[0]?.bounds.width).toBe(1920);
  });

  it('rejects a window entry carrying text, which belongs to readText', () => {
    const parsed = PerceptionListWindowsResult.parse({
      windows: [
        { id: 'w-1', processName: 'Code.exe', title: 'a', state: 'background', browser: false },
      ],
    });
    expect(parsed.windows[0]).not.toHaveProperty('text');
  });
});

describe('perception.readText', () => {
  it('reads one named window', () => {
    const parsed = PerceptionReadTextParams.parse({ windowId: 'w-1' });
    expect(parsed.windowId).toBe('w-1');
  });

  it('reads the foreground window when no window is named', () => {
    expect(PerceptionReadTextParams.parse({}).windowId).toBeUndefined();
  });

  it('defaults maxChars to the documented per-window budget', () => {
    expect(PerceptionReadTextParams.parse({}).maxChars).toBe(DEFAULT_WINDOW_TEXT_CHARS);
  });

  it('refuses a maxChars above the hard ceiling', () => {
    expect(
      PerceptionReadTextParams.safeParse({ maxChars: MAX_WINDOW_TEXT_CHARS + 1 }).success,
    ).toBe(false);
    expect(PerceptionReadTextParams.safeParse({ maxChars: 0 }).success).toBe(false);
  });

  it('has no scope parameter, so there is no way to ask for every window at once', () => {
    // The whole cost argument of this phase rests on this. Measured on a twelve-window
    // desktop, reading everything is 46,491 characters, about 11,600 tokens, in one call.
    expect(Object.keys(PerceptionReadTextParams.shape).sort()).toEqual(['maxChars', 'windowId']);
  });

  it('answers for exactly one window, never a list', () => {
    const parsed = PerceptionReadTextResult.parse({
      windowId: 'w-1',
      text: 'error TS2532',
      truncated: false,
      source: 'uia',
    });
    expect(parsed.windowId).toBe('w-1');
    expect(Array.isArray(parsed.text)).toBe(false);
  });

  it('says when it handed back a prefix rather than the whole window', () => {
    expect(
      PerceptionReadTextResult.parse({
        windowId: 'w-1',
        text: 'x'.repeat(10),
        truncated: true,
        source: 'uia',
      }).truncated,
    ).toBe(true);
  });

  it('marks OCR text, which may contain recognition errors', () => {
    expect(
      PerceptionReadTextResult.safeParse({
        windowId: 'w-1',
        text: 'rn vs m',
        truncated: false,
        source: 'ocr',
      }).success,
    ).toBe(true);
  });

  it('rejects a source it does not know', () => {
    expect(
      PerceptionReadTextResult.safeParse({
        windowId: 'w-1',
        text: '',
        truncated: false,
        source: 'guesswork',
      }).success,
    ).toBe(false);
  });

  it('returns a refusal instead of text for an excluded window', () => {
    const parsed = PerceptionReadTextResult.parse({
      windowId: 'w-1',
      text: '',
      truncated: false,
      source: 'uia',
      blocked: { rule: 'processName', entry: '1Password.exe' },
    });
    expect(parsed.blocked?.entry).toBe('1Password.exe');
    expect(parsed.text).toBe('');
  });
});

describe('perception.readText notes', () => {
  const base = { windowId: 'w-1', text: 'hello', truncated: false, source: 'uia' as const };

  it('carries notes that qualify what was read', () => {
    const parsed = PerceptionReadTextResult.parse({
      ...base,
      notes: ['This window exposes only its menus.'],
    });
    expect(parsed.notes).toEqual(['This window exposes only its menus.']);
  });

  it('leaves notes absent when there is nothing to qualify', () => {
    expect(PerceptionReadTextResult.parse(base).notes).toBeUndefined();
  });

  it('keeps notes out of the text field, so a pet cannot quote one as window content', () => {
    const parsed = PerceptionReadTextResult.parse({ ...base, notes: ['a caveat'] });
    expect(parsed.text).toBe('hello');
    expect(parsed.text).not.toContain('caveat');
  });

  it('rejects notes that are not strings', () => {
    expect(PerceptionReadTextResult.safeParse({ ...base, notes: [{ a: 1 }] }).success).toBe(false);
  });
});

describe('models.list', () => {
  it('takes a provider id and answers with models and where they came from', () => {
    expect(paramsSchemaFor('models.list').safeParse({ providerId: 'openrouter' }).success).toBe(
      true,
    );
    expect(paramsSchemaFor('models.list').safeParse({ providerId: '' }).success).toBe(false);
    const result = resultSchemaFor('models.list').parse({
      models: ['nvidia/nemotron-3-super-120b-a12b'],
      source: 'fallback',
    });
    expect(result.source).toBe('fallback');
    expect(resultSchemaFor('models.list').safeParse({ models: [], source: 'guess' }).success).toBe(
      false,
    );
  });
});

describe('perception.captureWindow', () => {
  it('names one listed window and a size bound', () => {
    expect(PerceptionCaptureWindowParams.parse({ windowId: 'w-1', maxLongSide: 1568 })).toEqual({
      windowId: 'w-1',
      maxLongSide: 1568,
    });
    expect(PerceptionCaptureWindowParams.safeParse({ maxLongSide: 1568 }).success).toBe(false);
  });

  it('answers with a picture, or with no picture and the reason', () => {
    expect(
      PerceptionCaptureWindowResult.parse({
        windowId: 'w-1',
        image: { mime: 'image/png', base64: 'cG5n', width: 10, height: 10 },
      }).image?.width,
    ).toBe(10);
    expect(
      PerceptionCaptureWindowResult.parse({
        windowId: 'w-1',
        blocked: { rule: 'titlePattern', entry: '.env' },
        notes: ['a blind spot'],
      }).image,
    ).toBeUndefined();
  });
});

describe('providers.check', () => {
  it('names the provider, and answers ok or a plain message', () => {
    expect(paramsSchemaFor('providers.check').parse({ providerId: 'openrouter' })).toEqual({
      providerId: 'openrouter',
    });
    expect(resultSchemaFor('providers.check').parse({ ok: true })).toEqual({ ok: true });
    const failed = { ok: false, message: 'OpenRouter turned that key down.' };
    expect(resultSchemaFor('providers.check').parse(failed)).toEqual(failed);
    expect(resultSchemaFor('providers.check').safeParse({ ok: false }).success).toBe(false);
  });
});

describe('screen.pointAt', () => {
  it('knows the pointer capability', () => {
    expect(HostCapability.safeParse('pointer').success).toBe(true);
  });

  it('points at an element by its name inside one window, with an optional label', () => {
    const parsed = ScreenPointAtParams.parse({ windowId: 'w-1', name: 'Export', label: 'Export' });
    expect(parsed).toEqual({ windowId: 'w-1', name: 'Export', label: 'Export' });
  });

  it('points at a rectangle of one display, in its own pixels', () => {
    const parsed = ScreenPointAtParams.parse({
      displayId: 2528732444,
      rect: { x: -10, y: 20, width: 30, height: 40 },
    });
    expect(parsed).toEqual({
      displayId: 2528732444,
      rect: { x: -10, y: 20, width: 30, height: 40 },
    });
  });

  it('rejects a rectangle with a negative or zero size', () => {
    for (const rect of [
      { x: 0, y: 0, width: -5, height: 10 },
      { x: 0, y: 0, width: 10, height: 0 },
    ]) {
      expect(ScreenPointAtParams.safeParse({ displayId: 1, rect }).success).toBe(false);
    }
  });

  it('rejects a label over 40 characters, an empty name, and a mix of both shapes', () => {
    expect(
      ScreenPointAtParams.safeParse({ windowId: 'w-1', name: 'x', label: 'a'.repeat(41) }).success,
    ).toBe(false);
    expect(ScreenPointAtParams.safeParse({ windowId: 'w-1', name: '' }).success).toBe(false);
    expect(
      ScreenPointAtParams.safeParse({
        windowId: 'w-1',
        name: 'Export',
        displayId: 1,
        rect: { x: 0, y: 0, width: 1, height: 1 },
      }).success,
    ).toBe(false);
  });

  it('answers shown on a screen, or not shown with the reason', () => {
    expect(ScreenPointAtResult.parse({ shown: true, screen: 2 })).toEqual({
      shown: true,
      screen: 2,
    });
    const refused = ScreenPointAtResult.parse({
      shown: false,
      blocked: { rule: 'processName', entry: '1Password.exe' },
      notes: ['a blind spot'],
    });
    expect(refused.blocked?.entry).toBe('1Password.exe');
    expect(ScreenPointAtResult.safeParse({ shown: true, screen: 0 }).success).toBe(false);
  });

  it('is a core-to-host method', () => {
    expect(coreToHostMethods['screen.pointAt'].params).toBe(ScreenPointAtParams);
    expect(coreToHostMethods['screen.pointAt'].result).toBe(ScreenPointAtResult);
  });
});
