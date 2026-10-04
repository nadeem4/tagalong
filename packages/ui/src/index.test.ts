import { describe, expect, it } from 'vitest';
import * as ui from './index';

describe('ui package surface', () => {
  it('exports the components and the fake bridge hosts build against', () => {
    expect(Object.keys(ui).sort()).toEqual(
      [
        'ChatPanel',
        'CrewStrip',
        'DEFAULT_PET_COLOR',
        'Composer',
        'SightBar',
        'HostBridgeProvider',
        'MessageList',
        'PetAvatar',
        'createFakeHostBridge',
        'useHostBridge',
      ].sort(),
    );
  });
});
