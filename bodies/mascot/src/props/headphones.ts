/* Over-ear headphones for a head about 1.1 wide. The origin is the middle
   of the head; the band arches over the top, a little behind the middle. */

import type { PropSpec } from './attach';
import type { PartSpec, Vec3 } from '../spec/types';

const band: PartSpec[] = [];
const STEPS = 8;
const point = (i: number): Vec3 => {
  const t = (i / STEPS) * Math.PI;
  return [0.72 * Math.cos(t), 0.5 * Math.sin(t), -0.1];
};
for (let i = 0; i < STEPS; i++)
  band.push({
    bone: 'attach',
    shape: 'capsule',
    from: point(i),
    to: point(i + 1),
    radius: 0.032,
    material: 'band',
  });

export const headphones: PropSpec = {
  name: 'phones',
  materials: {
    band: { color: '#12162b', f0: 0.04, spec: 0.5, shininess: 50, rim: 0.3 },
    cup: { color: '#2b3560', f0: 0.05, spec: 0.7, shininess: 70, rim: 0.4, gloss: 0.5 },
    glow: { color: '#7cb8f2', emit: '#7cb8f2', emitStrength: 0.9 },
  },
  parts: [
    ...band,
    ...([-1, 1] as const).flatMap((s): PartSpec[] => [
      {
        bone: 'attach',
        shape: 'cylinder',
        at: [0.7 * s, 0, 0],
        rot: [0, 0, 1.5708],
        radius: 0.18,
        half: 0.06,
        round: 0.035,
        material: 'cup',
      },
      {
        bone: 'attach',
        shape: 'cylinder',
        at: [0.765 * s, 0, 0],
        rot: [0, 0, 1.5708],
        radius: 0.1,
        half: 0.01,
        round: 0.005,
        material: 'glow',
      },
    ]),
  ],
};
