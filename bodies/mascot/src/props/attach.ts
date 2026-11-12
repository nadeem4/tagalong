/* Props as data. A prop is a few parts (and maybe a bone or two) in its own
   local space; `attachProps` hangs it on a character's bone, shows it only
   in the moods you name, and returns a new spec. Any character can reuse
   any prop. Props may not carve (`op: 'sub'`): a carve cuts everything
   declared before it, which would cut the body. */

import type {
  Axis,
  BoneSpec,
  CharacterSpec,
  Expression,
  MaterialSpec,
  Motion,
  PartSpec,
  Vec3,
} from '../spec/types';

export interface PropSpec {
  name: string;
  /** Materials of its own, by local name; they join the character as `name.material`. */
  materials: Record<string, MaterialSpec>;
  /** Prop bones, parented to another prop bone or (no parent) to the attach bone. Pivots are in prop space. */
  bones?: BoneSpec[];
  /** Parts on a prop bone, or on the attach bone when `bone` is `'attach'`. Coordinates are in prop space. */
  parts: PartSpec[];
  /** Acting for prop bones, keyed by expression, like a character's. */
  acting?: Partial<Record<Expression, Record<string, Partial<Record<Axis, Motion>>>>>;
}

export interface PropAttach {
  /** The character bone the prop hangs on. */
  bone: string;
  /** Where the prop's origin sits in that bone's space. */
  at?: Vec3;
  /** Resizes the prop; props are drawn about one unit tall mascots. Default 1. */
  scale?: number;
  /** The moods it shows in. */
  moods: string[];
  /** Recolours the prop's materials by local name. */
  colors?: Record<string, string>;
}

const ATTACH = 'attach';
const sc = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/* every length in a part, times s */
function scaled(p: PartSpec, s: number): PartSpec {
  if (s === 1) return p;
  const q: Record<string, unknown> = { ...p };
  for (const key of ['radius', 'round', 'half', 'r1', 'r2', 'corner', 'width', 'depth'] as const) {
    const v = (p as unknown as Record<string, unknown>)[key];
    if (typeof v === 'number') q[key] = v * s;
    else if (Array.isArray(v)) q[key] = v.map((n: number) => n * s);
  }
  for (const key of ['radii', 'from', 'to'] as const) {
    const v = (p as unknown as Record<string, unknown>)[key];
    if (Array.isArray(v)) q[key] = v.map((n: number) => n * s);
  }
  return q as unknown as PartSpec;
}

export function attachProps(
  spec: CharacterSpec,
  props: Array<[PropSpec, PropAttach]>,
): CharacterSpec {
  const out: CharacterSpec = {
    ...spec,
    materials: { ...spec.materials },
    bones: [...spec.bones],
    parts: [...spec.parts],
    acting: { ...spec.acting },
    moods: { ...spec.moods },
  };
  for (const [prop, a] of props) {
    const s = a.scale ?? 1;
    const origin: Vec3 = a.at ?? [0, 0, 0];
    const mat = (m: string) => `${prop.name}.${m}`;
    for (const [m, ms] of Object.entries(prop.materials))
      out.materials[mat(m)] = { ...ms, color: a.colors?.[m] ?? ms.color };

    /* where each prop bone's pivot is from the prop's origin, for the scale pivots */
    const fromOrigin = new Map<string, Vec3>([[ATTACH, [0, 0, 0]]]);
    for (const b of prop.bones ?? []) {
      const parent = b.parent ?? ATTACH;
      const base = fromOrigin.get(parent);
      if (!base)
        throw new Error(
          `${prop.name}: bone "${b.name}" names parent "${parent}", which is not declared before it`,
        );
      fromOrigin.set(b.name, add(base, sc(b.pivot, s)));
      out.bones.push({
        ...b,
        name: `${prop.name}.${b.name}`,
        parent: b.parent ? `${prop.name}.${b.parent}` : a.bone,
        pivot: b.parent ? sc(b.pivot, s) : add(origin, sc(b.pivot, s)),
      });
    }

    for (const p of prop.parts) {
      if (p.op === 'sub')
        throw new Error(`${prop.name}: props cannot use op "sub"; it would carve the character`);
      const bone = p.bone === ATTACH ? ATTACH : p.bone;
      const here = fromOrigin.get(bone);
      if (!here)
        throw new Error(
          `${prop.name}: a part names bone "${bone}", which the prop does not declare`,
        );
      const sp = scaled(p, s);
      const on = bone === ATTACH;
      const at = add(sc(p.at ?? [0, 0, 0], s), on ? origin : [0, 0, 0]);
      /* scale about the prop's origin, as seen from the part's bone */
      const pivot: Vec3 = on ? origin : sc(here, -1);
      out.parts.push({
        ...sp,
        bone: on ? a.bone : `${prop.name}.${bone}`,
        material: mat(p.material),
        at,
        pivot,
        moods: a.moods,
      });
    }

    for (const [expression, perBone] of Object.entries(prop.acting ?? {}) as Array<
      [Expression, Record<string, Partial<Record<Axis, Motion>>>]
    >) {
      const into = (out.acting![expression] = { ...out.acting![expression] });
      for (const [bone, axes] of Object.entries(perBone)) into[`${prop.name}.${bone}`] = axes;
    }
  }
  return out;
}
