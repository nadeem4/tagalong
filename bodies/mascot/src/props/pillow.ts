/* A soft pillow to rest on. The origin is the middle of the pillow, wider
   than tall. New in the Tagalong fork (not in wobnimo). */

import type { PropSpec } from './attach';

export const pillow: PropSpec = {
  name: 'pillow',
  materials: {
    cloth: { color: '#8fa6e8', f0: 0.03, spec: 0.15, shininess: 10, rim: 0.3, sheen: 0.5 },
    trim: { color: '#f4f6ff', f0: 0.03, spec: 0.15, shininess: 10, rim: 0.3, sheen: 0.4 },
  },
  parts: [
    { bone: 'attach', shape: 'ellipsoid', radii: [0.42, 0.14, 0.26], material: 'cloth' },
    {
      bone: 'attach',
      shape: 'ellipsoid',
      at: [0, 0.1, 0],
      radii: [0.3, 0.05, 0.18],
      material: 'trim',
    },
  ],
};
