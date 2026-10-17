/**
 * Test helpers for the check-in: `fakeMind`, a brain that records every request and answers
 * from a script (a reply, a throw, or a hang until the call is aborted), and `win`.
 * Never imported by product code.
 */
import type { Pet, WindowEntry } from '@tagalong/protocol';
import type { BrainProvider, BrainRequest, BrainResult } from '../providers';

export type MindStep =
  string | { reply: string; stopReason?: BrainResult['stopReason'] } | { throws: Error } | 'hang';

export interface FakeMind {
  requests: BrainRequest[];
  /** The pets each call was resolved for: the summaries model shows up here. */
  asked: Pet[];
  resolve: (pet: Pet) => BrainProvider;
}

/** Answers each call with the next step; the last step repeats. */
export function fakeMind(...initial: MindStep[]): FakeMind {
  const steps: MindStep[] = initial.length > 0 ? initial : ['NOTHING'];
  const requests: BrainRequest[] = [];
  const asked: Pet[] = [];
  const provider: BrainProvider = {
    id: 'fake',
    capabilities: { vision: false, tools: false },
    complete: (request, _events, signal) => {
      requests.push(request);
      const step = steps.length > 1 ? steps.shift()! : steps[0]!;
      if (step === 'hang') {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      if (typeof step === 'object' && 'throws' in step) return Promise.reject(step.throws);
      const reply = typeof step === 'string' ? { reply: step } : step;
      return Promise.resolve({
        text: reply.reply,
        stopReason: reply.stopReason ?? 'end',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    },
  };
  return {
    requests,
    asked,
    resolve: (pet) => {
      asked.push(pet);
      return provider;
    },
  };
}

export const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  model: 'claude-opus-5',
  providerId: 'anthropic',
  roleId: 'companion',
};

export function win(id: string, title: string, extra: Partial<WindowEntry> = {}): WindowEntry {
  return { id, processName: 'Code.exe', title, state: 'foreground', browser: false, ...extra };
}

/** The user message a request sent, as one string. */
export function sentText(request: BrainRequest): string {
  return request.messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}
