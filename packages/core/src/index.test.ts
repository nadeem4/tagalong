import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@tagalong/protocol';
import { engineInfo, getRole, recommendedModel } from './index';

describe('engineInfo', () => {
  it('reports the protocol version it was built against', () => {
    expect(engineInfo().protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('points hosts at the loopback socket', () => {
    expect(engineInfo(47321).url).toBe('ws://127.0.0.1:47321');
  });

  it('names itself for the hello handshake', () => {
    expect(engineInfo().name).toBe('tagalong-engine');
  });
});

describe('role helpers', () => {
  it('are exported for hosts: a lookup and the recommended model', () => {
    const companion = getRole('companion');
    expect(companion?.name).toBe('Companion');
    expect(recommendedModel(companion!, 'anthropic')?.model).toBe('claude-haiku-4-5');
  });
});
