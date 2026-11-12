/* A small pedestal desk. The origin is the middle of the top surface. */

import type { PropSpec } from './attach';

export const desk: PropSpec = {
  name: 'desk',
  materials: {
    top: { color: '#2b3560', f0: 0.05, spec: 0.5, shininess: 50, rim: 0.4, gloss: 0.4 },
    edge: { color: '#7cb8f2', f0: 0.05, spec: 0.5, shininess: 50, rim: 0.3 },
  },
  parts: [
    { bone: 'attach', shape: 'roundBox', half: [0.46, 0.025, 0.26], round: 0.02, material: 'top' },
    {
      bone: 'attach',
      shape: 'roundBox',
      at: [0, -0.02, 0.258],
      half: [0.44, 0.006, 0.006],
      round: 0.005,
      material: 'edge',
    },
    {
      bone: 'attach',
      shape: 'capsule',
      from: [0, -0.03, 0],
      to: [0, -0.23, 0],
      radius: 0.05,
      material: 'top',
    },
    {
      bone: 'attach',
      shape: 'cylinder',
      at: [0, -0.24, 0],
      radius: 0.16,
      half: 0.012,
      round: 0.01,
      material: 'top',
    },
  ],
};
