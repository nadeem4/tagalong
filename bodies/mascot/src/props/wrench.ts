/* A spanner, for a claw. The origin is where it is gripped; the head points down -y. */

import type { PropSpec } from './attach';

export const wrench: PropSpec = {
  name: 'wrench',
  materials: {
    steel: {
      color: '#a3aac4',
      f0: 0.45,
      spec: 1,
      shininess: 120,
      metal: 0.85,
      rim: 0.3,
      gloss: 0.7,
    },
    grip: { color: '#12162b', f0: 0.03, spec: 0.15, shininess: 12, rim: 0.2 },
  },
  parts: [
    {
      bone: 'attach',
      shape: 'capsule',
      from: [0, 0.04, 0],
      to: [0, -0.3, 0],
      radius: 0.045,
      material: 'grip',
    },
    {
      bone: 'attach',
      shape: 'capsule',
      from: [0, -0.3, 0],
      to: [0, -0.46, 0],
      radius: 0.038,
      material: 'steel',
    },
    { bone: 'attach', shape: 'sphere', at: [0, -0.48, 0], radius: 0.105, material: 'steel' },
    {
      bone: 'attach',
      shape: 'capsule',
      from: [-0.075, -0.52, 0],
      to: [-0.075, -0.62, 0],
      radius: 0.04,
      material: 'steel',
    },
    {
      bone: 'attach',
      shape: 'capsule',
      from: [0.075, -0.52, 0],
      to: [0.075, -0.62, 0],
      radius: 0.04,
      material: 'steel',
    },
  ],
};
