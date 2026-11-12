/* A laptop whose lid swings open while the working expression plays; the
   origin is the middle of the base, facing +z. Closed it lies flat. */

import type { PropSpec } from './attach';

export const laptop: PropSpec = {
  name: 'laptop',
  materials: {
    shell: {
      color: '#c9cee0',
      f0: 0.07,
      spec: 0.8,
      shininess: 90,
      metal: 0.25,
      rim: 0.4,
      gloss: 0.5,
    },
    keys: { color: '#12162b', f0: 0.03, spec: 0.3, shininess: 30, rim: 0.2 },
    glass: {
      color: '#0b1022',
      emit: '#7cb8f2',
      emitStrength: 0.55,
      f0: 0.04,
      spec: 0.6,
      shininess: 120,
    },
    code: { color: '#f2c14e', emit: '#f2c14e', emitStrength: 0.9 },
  },
  bones: [{ name: 'lid', pivot: [0, 0.02, -0.2], rest: { rx: 1.5 } }],
  parts: [
    { bone: 'attach', shape: 'roundBox', half: [0.4, 0.02, 0.22], round: 0.02, material: 'shell' },
    {
      bone: 'attach',
      shape: 'roundBox',
      at: [0, 0.022, 0.03],
      half: [0.34, 0.004, 0.14],
      round: 0.004,
      material: 'keys',
    },
    {
      bone: 'lid',
      shape: 'roundBox',
      at: [0, 0.25, 0],
      half: [0.4, 0.25, 0.012],
      round: 0.012,
      material: 'shell',
    },
    {
      bone: 'lid',
      shape: 'plate',
      at: [0, 0.25, 0.012],
      half: [0.35, 0.2],
      corner: 0.03,
      depth: 0.004,
      material: 'glass',
    },
    {
      bone: 'lid',
      shape: 'plate',
      at: [-0.12, 0.38, 0.019],
      half: [0.12, 0.014],
      corner: 0.01,
      depth: 0.003,
      material: 'code',
    },
    {
      bone: 'lid',
      shape: 'plate',
      at: [-0.06, 0.31, 0.019],
      half: [0.2, 0.014],
      corner: 0.01,
      depth: 0.003,
      material: 'code',
    },
    {
      bone: 'lid',
      shape: 'plate',
      at: [-0.1, 0.24, 0.019],
      half: [0.15, 0.014],
      corner: 0.01,
      depth: 0.003,
      material: 'code',
    },
    {
      bone: 'lid',
      shape: 'plate',
      at: [-0.17, 0.17, 0.019],
      half: [0.08, 0.014],
      corner: 0.01,
      depth: 0.003,
      material: 'code',
    },
  ],
  /* closed (rx 1.5) plus this lands the lid just past upright, leaning back */
  acting: { working: { lid: { rx: -1.72 } } },
};
