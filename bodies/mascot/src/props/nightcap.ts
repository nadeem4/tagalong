/* A nightcap draped to one side. The origin is the middle of the head's top. */

import type { PropSpec } from './attach';

export const nightcap: PropSpec = {
  name: 'cap',
  materials: {
    cloth: { color: '#4b5bb0', f0: 0.03, spec: 0.2, shininess: 15, rim: 0.3, sheen: 0.4 },
    fluff: { color: '#f4f6ff', f0: 0.03, spec: 0.15, shininess: 10, rim: 0.3, sheen: 0.5 },
  },
  parts: [
    {
      bone: 'attach',
      shape: 'roundCone',
      from: [-0.1, 0.0, 0],
      to: [-0.5, 0.2, 0],
      r1: 0.37,
      r2: 0.15,
      blend: 0.05,
      material: 'cloth',
    },
    {
      bone: 'attach',
      shape: 'roundCone',
      from: [-0.5, 0.2, 0],
      to: [-0.76, 0.02, 0],
      r1: 0.15,
      r2: 0.08,
      blend: 0.05,
      material: 'cloth',
    },
    {
      bone: 'attach',
      shape: 'cylinder',
      at: [-0.1, -0.01, 0],
      radius: 0.385,
      half: 0.05,
      round: 0.04,
      material: 'fluff',
    },
    { bone: 'attach', shape: 'sphere', at: [-0.82, -0.03, 0], radius: 0.1, material: 'fluff' },
  ],
};
