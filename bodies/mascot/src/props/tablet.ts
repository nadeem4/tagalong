/* A tablet held screen-out. The origin is the middle of the tablet. */

import type { PropSpec } from './attach';

export const tablet: PropSpec = {
  name: 'tablet',
  materials: {
    bezel: { color: '#12162b', f0: 0.04, spec: 0.8, shininess: 90, rim: 0.3, gloss: 0.6 },
    glass: {
      color: '#0b1022',
      emit: '#7cb8f2',
      emitStrength: 0.6,
      f0: 0.04,
      spec: 0.6,
      shininess: 120,
    },
    text: { color: '#f4f6ff', emit: '#f4f6ff', emitStrength: 0.7 },
  },
  parts: [
    {
      bone: 'attach',
      shape: 'roundBox',
      half: [0.17, 0.22, 0.014],
      round: 0.014,
      rot: [-0.25, -0.25, 0],
      material: 'bezel',
    },
    {
      bone: 'attach',
      shape: 'plate',
      at: [0.0, 0.0, 0.016],
      half: [0.14, 0.19],
      corner: 0.025,
      depth: 0.004,
      rot: [-0.25, -0.25, 0],
      material: 'glass',
    },
    {
      bone: 'attach',
      shape: 'plate',
      at: [-0.01, 0.1, 0.03],
      half: [0.09, 0.012],
      corner: 0.008,
      depth: 0.003,
      rot: [-0.25, -0.25, 0],
      material: 'text',
    },
    {
      bone: 'attach',
      shape: 'plate',
      at: [0.0, 0.04, 0.03],
      half: [0.1, 0.012],
      corner: 0.008,
      depth: 0.003,
      rot: [-0.25, -0.25, 0],
      material: 'text',
    },
    {
      bone: 'attach',
      shape: 'plate',
      at: [-0.03, -0.02, 0.03],
      half: [0.07, 0.012],
      corner: 0.008,
      depth: 0.003,
      rot: [-0.25, -0.25, 0],
      material: 'text',
    },
  ],
};
