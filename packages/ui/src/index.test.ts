import { describe, expect, it } from 'vitest';
import * as ui from './index';

describe('ui package surface', () => {
  it('exports the components and the fake bridge hosts build against', () => {
    expect(Object.keys(ui).sort()).toEqual(
      [
        'ChatPanel',
        'CompanionBubble',
        'CrewStrip',
        'DEFAULT_PET_COLOR',
        'Composer',
        'SightBar',
        'HostBridgeProvider',
        'MessageList',
        'HomeView',
        'THEMES',
        'themeById',
        'PixelSprite',
        'characterFor',
        'PetAvatar',
        'PetSettings',
        'CrewList',
        'SETTINGS_CSS',
        'createFakeHostBridge',
        'estimateImageTokens',
        'useHostBridge',
        'jobFor',
        'officeTokens',
      ].sort(),
    );
  });
});
