/** Tests for the package's public exports. */

import { describe, expect, it } from 'vitest';
import * as ui from './index';

describe('ui package surface', () => {
  it('exports the components and the fake bridge hosts build against', () => {
    expect(Object.keys(ui).sort()).toEqual(
      [
        'ApprovedReport',
        'CompanionBubble',
        'GreetingLine',
        'DockPet',
        'HostBridgeProvider',
        'HomeView',
        'BeanClip',
        'SETTINGS_CSS',
        'createFakeHostBridge',
        'PushToTalk',
        'ListenController',
      ].sort(),
    );
  });
});
