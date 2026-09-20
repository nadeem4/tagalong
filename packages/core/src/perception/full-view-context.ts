import type { DisplaySnapshot, HostCapability } from '@tagalong/protocol';
import type { FullViewContext } from './full-view-tools';
import type { PerceptionHost, PerceptionToolsetOptions } from './tools';

/**
 * Binds the full-view tools to whatever hosts are connected right now.
 *
 * Built per tool use, like everything else in the toolset: hosts connect and drop while a
 * conversation is in flight, so a context captured once would outlive the socket it
 * describes.
 */
export function fullViewContext(options: PerceptionToolsetOptions): FullViewContext {
  return {
    vision: () => options.vision?.() ?? false,

    async displays(): Promise<readonly DisplaySnapshot[] | undefined> {
      const host = options.hosts().find((candidate) => candidate.capabilities.includes('displays'));
      if (host === undefined) return undefined;
      return (await host.capture(['displays'])).displays ?? [];
    },

    /**
     * Requires both halves: the capability the host advertises, and the method it
     * actually implements.
     *
     * A host claiming `displays` with no `listWindows` is a wiring mistake, and this
     * phase has shipped that exact shape twice — an unanswered method reads to the user
     * as a pet that ignored them. Checking the method here turns it into a refusal the
     * pet can repeat instead of an exception that ends the turn.
     */
    host<K extends 'captureRegion' | 'listWindows' | 'readText'>(
      capability: HostCapability,
      method: K,
    ) {
      const found = options
        .hosts()
        .find(
          (candidate: PerceptionHost) =>
            candidate.capabilities.includes(capability) && typeof candidate[method] === 'function',
        );
      return found as ReturnType<FullViewContext['host']> | undefined;
    },
  };
}
