/* A party hat. The origin is the middle of its base. */

import type { PropSpec } from './attach';

export const partyHat: PropSpec = {
  name: 'hat',
  materials: {
    cone: { color: '#7cb8f2', f0: 0.05, spec: 0.6, shininess: 60, rim: 0.4, gloss: 0.5 },
    trim: { color: '#f2c14e', f0: 0.05, spec: 0.7, shininess: 70, rim: 0.5, gloss: 0.5 },
  },
  parts: [
    {
      bone: 'attach',
      shape: 'roundCone',
      from: [0, 0, 0],
      to: [0.08, 0.36, 0],
      r1: 0.2,
      r2: 0.012,
      material: 'cone',
    },
    {
      bone: 'attach',
      shape: 'cylinder',
      at: [0, -0.005, 0],
      radius: 0.205,
      half: 0.025,
      round: 0.02,
      material: 'trim',
    },
    { bone: 'attach', shape: 'sphere', at: [0.08, 0.38, 0], radius: 0.06, material: 'trim' },
  ],
};
