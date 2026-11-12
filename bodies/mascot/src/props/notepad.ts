/* A notepad with a few written lines. The origin is the middle of the pad,
   facing +z. New in the Tagalong fork (not in wobnimo). */

import type { PropSpec } from './attach';

export const notepad: PropSpec = {
  name: 'pad',
  materials: {
    paper: { color: '#f4f6ff', f0: 0.03, spec: 0.2, shininess: 15, rim: 0.2 },
    binding: { color: '#4b5bb0', f0: 0.04, spec: 0.4, shininess: 40, rim: 0.3 },
    ink: { color: '#2b3560' },
  },
  parts: [
    {
      bone: 'attach',
      shape: 'roundBox',
      half: [0.15, 0.2, 0.012],
      round: 0.008,
      material: 'paper',
    },
    {
      bone: 'attach',
      shape: 'roundBox',
      at: [0, 0.2, 0.004],
      half: [0.15, 0.022, 0.016],
      round: 0.01,
      material: 'binding',
    },
    {
      bone: 'attach',
      shape: 'plate',
      at: [-0.01, 0.08, 0.014],
      half: [0.1, 0.01],
      corner: 0.006,
      depth: 0.003,
      material: 'ink',
    },
    {
      bone: 'attach',
      shape: 'plate',
      at: [0.0, 0.01, 0.014],
      half: [0.11, 0.01],
      corner: 0.006,
      depth: 0.003,
      material: 'ink',
    },
    {
      bone: 'attach',
      shape: 'plate',
      at: [-0.03, -0.06, 0.014],
      half: [0.08, 0.01],
      corner: 0.006,
      depth: 0.003,
      material: 'ink',
    },
  ],
};
