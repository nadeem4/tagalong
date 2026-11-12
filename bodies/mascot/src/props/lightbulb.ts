/* An idea bulb. The origin is the middle of the glass. */

import type { PropSpec } from './attach';

export const lightbulb: PropSpec = {
  name: 'bulb',
  materials: {
    glass: {
      color: '#ffe29a',
      emit: '#ffcf5c',
      emitStrength: 0.95,
      f0: 0.05,
      spec: 0.8,
      shininess: 80,
      sss: 0.3,
      sssColor: '#ffd27a',
    },
    metal: {
      color: '#a3aac4',
      f0: 0.45,
      spec: 1,
      shininess: 120,
      metal: 0.85,
      rim: 0.3,
      gloss: 0.7,
    },
  },
  parts: [
    { bone: 'attach', shape: 'sphere', radius: 0.14, material: 'glass' },
    {
      bone: 'attach',
      shape: 'cylinder',
      at: [0, -0.165, 0],
      radius: 0.07,
      half: 0.035,
      round: 0.015,
      material: 'metal',
    },
    {
      bone: 'attach',
      shape: 'cylinder',
      at: [0, -0.235, 0],
      radius: 0.05,
      half: 0.03,
      round: 0.015,
      material: 'metal',
    },
  ],
};
