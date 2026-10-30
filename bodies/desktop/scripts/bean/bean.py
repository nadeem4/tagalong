"""
Bean: the 3D Scout, built and rendered headless in Blender from this script alone.

  blender -b -P bean.py -- stills          # one still per state, 512 px, out/stills/
  blender -b -P bean.py -- stills working  # only the named states
  blender -b -P bean.py -- frames [names]   # every clip as 512 px masters, out/frames/<clip>/
  blender -b -P bean.py -- save            # also save bean.blend for hand edits

Shapes, sizes and colours follow buildBean in scout-figures.html. Everything is modelled in
the preview's Y-up space under one root empty turned 90 degrees, so its numbers port as is.
"""

import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

PI, TAU = math.pi, math.tau
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')

# ---------- Palette (from the preview) ----------
NAVY, OFF, GOLD = '#2E3566', '#F6F7FB', '#F2C14E'
EYE, NOSE, PERI = '#2A2738', '#2A1E1A', '#5A64B0'
PAL = {'fur': '#F39B5E', 'cream': '#FFF3E6', 'tip': '#5A3A2C', 'acc': '#F2A9A0'}
BOOK = '#5FA8A0'

SIZE = 512
CAM_YAW = math.radians(28)   # camera swung to Scout's right so the tail nub peeks out
LAPTOP_YAW = -1.0            # laptop side-on: paws on the keys stay visible
SAMPLES = 32


# ---------- Colour and materials ----------
def lin(hex_, mix_white=0.0):
    h = hex_.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        c = c + (1 - c) * mix_white
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def _inp(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    return None


def _set(node, value, *names):
    s = _inp(node, *names)
    if s is not None:
        s.default_value = value


_MATS = {}


def clay(hex_):
    """Soft clay: matte, a velvet sheen and a touch of subsurface."""
    if hex_ in _MATS:
        return _MATS[hex_]
    m = bpy.data.materials.new('clay ' + hex_)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    _set(b, lin(hex_, .05), 'Base Color')
    _set(b, .78, 'Roughness')
    _set(b, .12, 'Subsurface Weight')
    _set(b, .04, 'Subsurface Scale')
    _set(b, 1.0, 'Sheen Weight')
    _set(b, .5, 'Sheen Roughness')
    _set(b, lin(hex_, .55), 'Sheen Tint')
    _set(b, .25, 'Specular IOR Level')
    _MATS[hex_] = m
    return m


def glossy(hex_, name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    _set(b, lin(hex_), 'Base Color')
    _set(b, .3, 'Roughness')
    _set(b, .7, 'Coat Weight')
    _set(b, .15, 'Coat Roughness')
    return m


def glow(hex_, name, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = lin(hex_)
    em.inputs['Strength'].default_value = strength
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], o.inputs[0])
    return m


def blob_material():
    """A soft dark blob under the feet, alpha only, so it sits on any desktop."""
    m = bpy.data.materials.new('blob')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'SPHERICAL'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (0, 0, 0)
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (.38, .38, .38, 1)
    ramp.color_ramp.elements.new(.5).color = (.14, .14, .14, 1)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = lin('#0C0A1E')
    mix = nt.nodes.new('ShaderNodeMixShader')
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs[0], grad.inputs['Vector'])
    nt.links.new(grad.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], o.inputs[0])
    try:
        m.surface_render_method = 'BLENDED'
    except AttributeError:
        m.blend_method = 'BLEND'
    return m


# ---------- Mesh builders (preview space, Y up) ----------
def _mesh(name, verts, faces, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    if smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    return me


def lathe(profile, segs=48, name='lathe'):
    """Revolve (radius, y) points round Y. A zero radius at either end becomes a pole."""
    verts, faces, rings = [], [], []
    for r, y in profile:
        if r <= 1e-6:
            rings.append([len(verts)])
            verts.append((0, y, 0))
        else:
            ring = []
            for j in range(segs):
                a = j / segs * TAU
                ring.append(len(verts))
                verts.append((r * math.sin(a), y, r * math.cos(a)))
            rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            faces += [(a[0], b[(j + 1) % segs], b[j]) for j in range(segs)]
        elif len(b) == 1:
            faces += [(a[j], a[(j + 1) % segs], b[0]) for j in range(segs)]
        else:
            faces += [(a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]) for j in range(segs)]
    return _mesh(name, verts, faces)   # outward normals for a profile running bottom to top


def sph(r, rings=24, segs=48):
    return lathe([(r * math.cos(-PI / 2 + PI * i / rings), r * math.sin(-PI / 2 + PI * i / rings))
                  for i in range(rings + 1)], segs, 'sph')


def cap(r, length, half=10, segs=32):
    pts = [(r * math.cos(-PI / 2 + PI / 2 * i / half), -length / 2 + r * math.sin(-PI / 2 + PI / 2 * i / half))
           for i in range(half + 1)]
    pts += [(r * math.cos(PI / 2 * i / half), length / 2 + r * math.sin(PI / 2 * i / half)) for i in range(half + 1)]
    return lathe(pts, segs, 'cap')


def cyl(top, bottom, h, segs=48):
    e = min(h * .2, .012)
    pts = [(0, -h / 2), (bottom - e, -h / 2), (bottom - e * .3, -h / 2 + e * .3), (bottom, -h / 2 + e),
           (top, h / 2 - e), (top - e * .3, h / 2 - e * .3), (top - e, h / 2), (0, h / 2)]
    return lathe(pts, segs, 'cyl')


def cone(r, h):
    """A cone with a rounded tip, base at y 0 (the preview's ear)."""
    pts = [(0, 0)]
    for i in range(15):
        t = i / 14 * .82
        pts.append((r * (1 - t) ** .9, t * h))
    rc = r * .18 ** .9
    for i in range(1, 7):
        a = i / 6 * PI / 2
        pts.append((rc * math.cos(a), .82 * h + .18 * h * math.sin(a)))
    pts[-1] = (0, pts[-1][1])
    return lathe(pts, 36, 'cone')


def tor(R, t, arc=TAU, useg=48, vseg=14):
    closed = arc >= TAU - 1e-6
    n = useg if closed else max(6, int(useg * arc / TAU) + 1)
    verts, faces = [], []
    for i in range(n if closed else n + 1):
        u = arc * i / n
        cx, cy = R * math.cos(u), R * math.sin(u)
        for j in range(vseg):
            v = TAU * j / vseg
            k = R + t * math.cos(v)
            verts.append((k * math.cos(u), k * math.sin(u), t * math.sin(v)))
    rows = n if closed else n + 1
    for i in range(n):
        i2 = (i + 1) % rows
        for j in range(vseg):
            j2 = (j + 1) % vseg
            faces.append((i * vseg + j, i2 * vseg + j, i2 * vseg + j2, i * vseg + j2))
    return _mesh('tor', verts, faces)


def box(x, y, z):
    hx, hy, hz = x / 2, y / 2, z / 2
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
         (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
    return _mesh('box', v, f, smooth=False)


def octa(r):
    v = [(r, 0, 0), (-r, 0, 0), (0, r, 0), (0, -r, 0), (0, 0, r), (0, 0, -r)]
    f = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    return _mesh('octa', v, f, smooth=False)


# ---------- Scene graph helpers ----------
COLL = None


def g(parent=None, p=(0, 0, 0), name='g'):
    o = bpy.data.objects.new(name, None)
    COLL.objects.link(o)
    o.empty_display_size = .1
    o.rotation_mode = 'ZYX'   # matches three.js 'XYZ' Euler order
    if parent is not None:
        o.parent = parent
    o.location = p
    return o


def m(parent, mesh, mat, p=None, s=None, r=None, name='m'):
    o = bpy.data.objects.new(name, mesh)
    COLL.objects.link(o)
    o.rotation_mode = 'ZYX'
    mesh.materials.append(clay(mat) if isinstance(mat, str) else mat)
    if parent is not None:
        o.parent = parent
    if p is not None:
        o.location = p
    if s is not None:
        o.scale = s
    if r is not None:
        o.rotation_euler = r
    return o


def stick(parent, a, b, r, mat):
    A, B = Vector(a), Vector(b)
    d = B - A
    o = m(parent, cap(r, d.length, 6, 16), mat)
    o.location = (A + B) / 2
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(d.normalized())
    return o


def bevel(o, w=.008, segs=3):
    mod = o.modifiers.new('bevel', 'BEVEL')
    mod.width = w
    mod.segments = segs
    return o


def show(o, on):
    """Hide or show an object and everything under it."""
    o.hide_render = not on
    o.hide_viewport = not on
    for c in o.children_recursive:
        c.hide_render = not on
        c.hide_viewport = not on


# ---------- The Bean ----------
class Rig:
    pass


def add_eyes(head, x, y, z, r, yaw, eye_mat, white):
    eyes = []
    for s in (-1, 1):
        e = Rig()
        e.s, e.r = s, r
        e.g = g(head, (s * x, y, z), 'eye')
        e.g.rotation_euler = (-.05, s * yaw, 0)
        e.base = Vector((s * x, y, z))
        e.range = r * .38
        e.open = g(e.g, name='eye open')
        m(e.open, sph(r), eye_mat, s=(.8, 1.1, .42))
        m(e.open, sph(r * .28), white, (r * .26, r * .5, r * .36))
        m(e.open, sph(r * .13), white, (-r * .26, -r * .4, r * .38))
        e.closed = m(e.g, tor(r * .6, r * .16, PI), eye_mat, (0, r * .15, r * .28), r=(0, 0, PI), name='eye closed')
        eyes.append(e)
    return eyes


def add_arm(parent, shoulder, s, L, r, maxStretch):
    a = Rig()
    a.s, a.L, a.r, a.maxStretch = s, L, r, maxStretch
    a.pivot = g(parent, shoulder, 'arm')
    a.pivot.rotation_mode = 'QUATERNION'
    me = cap(r, L)
    me.transform(Matrix.Translation((0, -L / 2, 0)))
    a.limb = m(a.pivot, me, PAL['fur'], name='limb')
    a.paw = m(a.pivot, sph(r * 1.12), PAL['cream'], (0, -L, 0), name='paw')
    a.rest = Vector(shoulder) + Vector((s * L * .38, -L * .92, L * .18))
    return a


def build_bean():
    F = Rig()
    F.root = g(None, (0, 0, 0), 'Bean')
    F.root.rotation_mode = 'XYZ'
    F.root.rotation_euler = (PI / 2, 0, 0)
    F.bob = g(F.root, name='bob')
    for s in (-1, 1):
        m(F.bob, sph(.15), PAL['cream'], (s * .3, .07, .32), (1, .55, 1.2), name='foot')
    F.headPivot = g(F.bob, (0, .08, 0), 'headPivot')
    F.head = g(F.headPivot, name='head')
    head = F.head
    m(head, sph(.8, 32, 64), PAL['fur'], (0, .9, 0), (1, 1.2, .9), name='body')
    m(head, sph(.42), PAL['cream'], (0, .58, .5), (1, .95, .6), name='belly')
    m(head, sph(.2), PAL['cream'], (0, 1.0, .66), (1.3, .75, .6), name='muzzle')
    m(head, sph(.058), NOSE, (0, 1.06, .77), (1.3, .9, .8), name='nose')
    for s in (-1, 1):
        m(head, sph(.1), PAL['acc'], (s * .48, 1.0, .555), (1, .6, .35), name='blush')
    eye_mat = glossy(EYE, 'eye')
    white = glow('#FFFFFF', 'eye light', 1.0)
    F.eyes = add_eyes(head, .28, 1.18, .61, .14, .4, eye_mat, white)
    # mouth: a small 'w'
    F.mouth_w = g(head, name='mouth')
    w = .034
    for s in (-1, 1):
        m(F.mouth_w, tor(w, w * .3, PI, 24, 10), NOSE, (s * w, .97, .77), r=(0, 0, PI))
    # ears
    F.ears = []
    for s in (-1, 1):
        e = Rig()
        e.s, e.splay = s, .3
        e.pivot = g(head, (s * .34, 1.64, -.02), 'ear')
        ear = g(e.pivot)
        ear.scale = (1, 1, .5)
        r, h = .17, .36
        m(ear, cone(r, h), PAL['fur'])
        m(ear, cone(r * .58, h * .62), PAL['cream'], (0, .04, r * .55))
        m(ear, cone(r * .44 * 1.06, h * .4 * 1.04), PAL['tip'], (0, h * .6, 0))
        F.ears.append(e)
    F.arms = [add_arm(head, (s * .66, .78, .32), s, .3, .1, 2.5) for s in (-1, 1)]
    F.tail = g(head, (.38, .34, -.58), 'tail')
    for p, r, c in (((0, 0, 0), .18, 'fur'), ((.12, .08, -.08), .17, 'fur'), ((.22, .2, -.1), .13, 'cream')):
        m(F.tail, sph(r), PAL[c], p)
    F.dims = dict(signY=2.32, headC=(0, 1.1, 0), headTop=2.0, headRx=.8, cloudX=.4, zX=.3, S=1.2)
    return F


# ---------- Props ----------
def make_book(F):
    book = g(F.bob, (0, .66, .92), 'book')
    book.scale = (1.25,) * 3
    inner = g(book)
    inner.rotation_euler = (-.95, 0, 0)
    w, h = .25, .32
    grips = []
    for s in (-1, 1):
        half = g(inner)
        half.rotation_euler = (0, -s * .26, 0)
        bevel(m(half, box(w * 1.04, h * 1.06, .03), BOOK, (s * w / 2, 0, -.022)), .008)
        bevel(m(half, box(w, h, .035), '#FFFDF6', (s * w * .49, 0, 0)), .006)
        for i in range(4):
            m(half, cap(.009, w * .55, 4, 10), '#B9B4C8', (s * w * .5, h * (.3 - i * .18), .02), r=(0, 0, PI / 2))
        grips.append(g(half, (s * w * .98, -h * .12, .02), 'grip'))
    page = g(inner, (0, 0, .022), 'page')
    bevel(m(page, box(w * .96, h * .96, .01), '#FFFFFF', (w * .48, 0, 0)), .004)
    F.book, F.book_grips, F.page = book, grips, page


def make_glasses(F):
    gl = g(F.head, (0, 1.18, .68), 'glasses')
    r, x, yaw = .16, .28, .4
    for s in (-1, 1):
        m(gl, tor(r, r * .14), NAVY, (s * x, 0, 0), r=(0, s * yaw, 0))
    m(gl, cap(r * .1, x * 2 - r * 2.1, 4, 12), NAVY, (0, r * .25, .02), r=(0, 0, PI / 2))
    F.glasses = gl


def make_laptop(F):
    stumpH = .2
    desk = g(F.bob, (.45, stumpH, .95), 'laptop')   # straight in front of Bean as the camera sees it
    desk.scale = (1.1,) * 3
    m(desk, cyl(.3, .36, stumpH), '#B88A5E', (0, -stumpH / 2 - .012, 0))
    m(desk, cyl(.3, .3, .024), '#E6C9A2', (0, -.012, 0))
    m(desk, tor(.2, .008), '#C9A47A', (0, .001, 0), r=(PI / 2, 0, 0))
    lap = g(desk)
    lap.rotation_euler = (0, LAPTOP_YAW, 0)
    lap.scale = (1.3,) * 3
    bevel(m(lap, box(.5, .035, .34), '#E4E7F0', (0, .018, 0)), .01)
    m(lap, box(.42, .008, .17), '#BFC4D6', (0, .038, -.04))
    screen = g(lap, (0, .036, .16))
    screen.rotation_euler = (.26, 0, 0)
    bevel(m(screen, box(.5, .34, .028), '#E4E7F0', (0, .17, 0)), .01)
    m(screen, box(.44, .28, .004), glow('#CFE2FF', 'screen', 1.2), (0, .175, -.016))
    m(screen, cyl(.035, .035, .006), NAVY, (0, .19, .016), r=(PI / 2, 0, 0))
    F.laptop = desk
    F.key_grips = [g(lap, (-.1, .06, -.06), 'keyL'), g(lap, (.1, .06, -.06), 'keyR')]


# ---------- Signs: what Scout is busy with, floating above ----------
def make_signs(F):
    d, S = F.dims, F.dims['S']
    signs = {}

    def at(p, name):
        o = g(F.bob, p, name)
        o.scale = (S,) * 3
        return o

    # Seeing: three arcs each side of the head
    o = g(F.bob, (0, d['headC'][1], d['headC'][2]), 'sign waves')
    arc = 1.05
    F.waves = []
    for s in (-1, 1):
        for i in range(3):
            F.waves.append((i, None))
            a = m(o, tor((.15 + i * .14) * S, .038 * S, arc, 48, 10), GOLD, (s * (d['headRx'] + .04), .05, .1))
            a.rotation_euler = (0, 0, -arc / 2 if s > 0 else PI - arc / 2)
            F.waves[-1] = (i, a)
    signs['waves'] = o

    # Thinking: a cloud with three dots, two bubbles trailing to the head
    o = at((d['cloudX'], d['signY'] + .12, .05), 'sign cloud')
    puffs = g(o)
    puffs.scale = (1, 1, .72)
    for x, y, r in ((0, 0, .25), (-.24, -.05, .18), (.24, -.04, .19), (-.11, .13, .19), (.13, .12, .18), (0, -.1, .18)):
        m(puffs, sph(r), OFF, (x, y, 0))
    F.cloud_dots = [m(o, sph(.047), NAVY, (x, -.01, .19)) for x in (-.13, 0, .13)]
    m(o, sph(.075), OFF, (-.36, -.3, 0))
    m(o, sph(.05), OFF, (-.46, -.44, 0))
    signs['cloud'] = o

    # Working: a gear and a spark
    o = at((0, d['signY'] + .1, 0), 'sign gear')
    gear = g(o)
    gear.rotation_euler = (0, 0, .2)
    m(gear, cyl(.2, .2, .09), OFF, r=(PI / 2, 0, 0))
    for i in range(8):
        a = i / 8 * TAU
        m(gear, cap(.045, .02, 6, 16), OFF, (math.cos(a) * .22, math.sin(a) * .22, 0), (1, 1, 1.15), (0, 0, a + PI / 2))
    m(gear, cyl(.075, .075, .1), NAVY, (0, 0, .01), r=(PI / 2, 0, 0))
    spark = g(o, (.32, .22, .05))
    m(spark, octa(.11), GOLD, s=(.32, 1, .32))
    m(spark, octa(.11), GOLD, s=(1, .32, .32))
    signs['gear'] = o
    F.gear, F.spark = gear, spark

    # Dozing: three z rising
    o = at((d['zX'], d['headTop'] + .02, .1), 'sign zzz')
    F.zs = []
    for i in range(3):
        z = g(o)
        F.zs.append(z)
        p = .18 + i * .3
        z.location = (p * .5, p * .75, 0)
        z.scale = (.6 + .8 * p,) * 3
        ww = .1
        stick(z, (-ww, ww, 0), (ww, ww, 0), .028, PERI)
        stick(z, (ww, ww, 0), (-ww, -ww, 0), .028, PERI)
        stick(z, (-ww, -ww, 0), (ww, -ww, 0), .028, PERI)
    signs['zzz'] = o

    for k in ('cloud', 'gear', 'zzz'):
        signs[k].rotation_euler = (0, CAM_YAW, 0)   # flat signs face the camera
    F.base = {k: tuple(o.location) for k, o in signs.items()}
    F.signs = signs


# ---------- States ----------
# arms: (left, right) target names. eyes: open | closed
STATES = {
    'idle':      dict(),
    'listening': dict(pitch=-.06, roll=.1, ear=1, eyeScale=1.1, sign='waves'),
    'thinking':  dict(arms=('rest', 'chin'), pitch=-.12, roll=-.1, ear=-.1, look=(.45, .7), sign='cloud'),
    'reading':   dict(arms=('bookL', 'bookR'), props=('book', 'glasses'), pitch=.26, look=(-.25, -.75)),
    'working':   dict(arms=('keyL', 'keyR'), props=('laptop',), pitch=.2, look=(0, -.45), sign='gear'),
    'dozing':    dict(pitch=.22, roll=.14, ear=-.8, eyes='closed', sign='zzz', y=-.02, sq=.985),
}


def arm_target(F, arm, name):
    """World position an arm reaches for."""
    def world(obj, p=(0, 0, 0)):
        return obj.matrix_world @ Vector(p)
    if name == 'chin':
        return world(F.head, (.3, .9, .72))
    if name == 'belly':
        return world(F.bob, (-arm.s * .04, .56, .8))
    if name in ('bookL', 'bookR'):
        return world(F.book_grips[0 if name == 'bookL' else 1])
    if name in ('keyL', 'keyR'):
        i = 0 if name == 'keyL' else 1
        return world(F.key_grips[i]) + Vector((0, 0, F.key_lift[i]))
    return world(F.head, arm.rest)


def aim_arm(F, arm, w):
    local = arm.pivot.parent.matrix_world.inverted() @ w
    d = local - arm.pivot.location
    ln = max(arm.L * .75, min(d.length - arm.r * .5, arm.L * arm.maxStretch))
    arm.pivot.rotation_quaternion = Vector((0, -1, 0)).rotation_difference(d.normalized())
    arm.limb.scale = (1, ln / arm.L, 1)
    arm.paw.location = (0, -ln, 0)


# ---------- Clips: frames at 12 fps; one-shots end on a frame that holds ----------
FPS = 12
CLIPS = {
    'idle': (36, True), 'listening': (36, True), 'working': (24, True), 'thinking': (36, True),
    'reading': (36, True), 'dozing': (48, True),
}
BLINKS = ('idle', 'listening')   # 2-frame blink clips the app plays at random
STILL_PH = {'reading': .4, 'idle': .5}


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def pose(F, name, ph=0.0, blink=0.0):
    """Pose Scout for a state at loop phase ph (0..1). blink: eye height while blinking, 0 = no blink."""
    st = STATES[name]

    def wave(k=1, off=0.0):
        return math.sin(TAU * (k * ph + off))

    props = st.get('props', ())
    show(F.book, 'book' in props)
    show(F.glasses, 'glasses' in props)
    show(F.laptop, 'laptop' in props)
    for k, o in F.signs.items():
        show(o, st.get('sign') == k)

    # ----- motion for this phase
    breath = (1 - math.cos(TAU * ph)) / 2
    y, sq, x = st.get('y', 0), st.get('sq', 1), 0.0
    pitch, roll, ear = st.get('pitch', 0), st.get('roll', 0), st.get('ear', 0)
    look = list(st.get('look', (0, 0)))
    twitch, wag = 0.0, .16 * wave()
    F.key_lift = (0.0, 0.0)
    if name in ('idle', 'listening', 'thinking', 'reading', 'working'):
        y += .02 * breath
    if name == 'idle' and .25 <= ph < .35:
        twitch = .22 * math.sin(PI * (ph - .25) / .1)
    if name == 'listening' and ph < .12:
        ear += .25 * math.sin(PI * ph / .12)
    if name == 'working':
        pitch += .025 * wave(3)
        F.key_lift = (.03 * max(0, wave(4)), .03 * max(0, wave(4, .5)))
    if name == 'reading':
        look[0] = -.6 + 1.2 * (ph / .82) if ph < .82 else .6 - 1.2 * ((ph - .82) / .18)
    if name == 'dozing':
        y += .015 * breath
        pitch += .04 * breath
        wag = .05 * wave()

    # ----- body
    F.bob.location = (x, y, 0)
    F.bob.scale = (1 + (1 - sq) * .6, sq, 1 + (1 - sq) * .6)
    F.head.scale = (1, 1 + .015 * breath, 1)
    F.headPivot.location = (0, .08 + .02 * breath, 0)
    F.headPivot.rotation_euler = (pitch, 0, roll)
    F.shadow.scale = (1 - y * .8,) * 3
    for e in F.ears:
        tw = twitch if e.s > 0 else 0
        e.pivot.rotation_euler = (.14 * ear if ear > 0 else .12 * ear, 0, -e.s * (e.splay - .1 * ear) - e.s * tw)
    F.tail.rotation_euler = (0, wag, wag * .3)

    # ----- face
    mode = st.get('eyes', 'open')
    es = st.get('eyeScale', 1)
    for e in F.eyes:
        e.g.location = e.base + Vector((look[0] * e.range, look[1] * e.range * .8, 0))
        show(e.open, mode == 'open')
        show(e.closed, mode == 'closed')
        e.open.scale = (es, es * (blink or 1), 1)

    # ----- signs
    for k in ('cloud', 'gear'):
        bx, by, bz = F.base[k]
        F.signs[k].location = (bx, by + .03 * wave() - (y - st.get('y', 0)), bz)   # cancel the body's own y offset (only dozing has one) so the signs stay put
    for i, a in F.waves:
        r = math.sin(PI * ((2 * ph - i * .3) % 1)) ** 2
        a.scale = (.85 + .3 * r,) * 3
    for i, o in enumerate(F.cloud_dots):
        o.scale = (.75 + .45 * max(0, math.sin(TAU * 3 * ph - i * .95)),) * 3
    F.gear.rotation_euler = (0, 0, .2 - TAU / 8 * ph)
    F.spark.scale = (.65 + .45 * (.5 + .5 * wave(2)),) * 3
    F.spark.rotation_euler = (0, 0, TAU / 4 * ph)
    for i, z in enumerate(F.zs):
        p = (ph + i / 3) % 1
        z.location = (p * .5, p * .75, 0)
        z.scale = (max(.01, (.6 + .8 * p) * math.sin(PI * p) ** .6),) * 3
    if name == 'reading' and ph > .7:
        show(F.page, True)
        F.page.rotation_euler = (0, -(.26 + (PI - .52) * smooth((ph - .7) / .3)), 0)
    else:
        show(F.page, False)

    # ----- arms reach once the body has moved
    bpy.context.view_layer.update()
    arms = st.get('arms', ('rest', 'rest'))
    for arm in F.arms:
        aim_arm(F, arm, arm_target(F, arm, arms[0 if arm.s < 0 else 1]))

    bpy.context.view_layer.update()


# ---------- Stage: lights, camera, film ----------
def stage():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    try:
        sc.eevee.taa_render_samples = SAMPLES
    except AttributeError:
        pass
    for attr, val in (('use_shadows', True), ('use_raytracing', True), ('shadow_ray_count', 2),
                      ('shadow_step_count', 8)):
        try:
            setattr(sc.eevee, attr, val)
        except (AttributeError, TypeError):
            pass
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = -.45

    # world: warm sky above, lilac bounce below (the preview's hemisphere light)
    w = bpy.data.worlds.new('clay sky')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = lin('#B6A6CF')
    mix.inputs['B'].default_value = lin('#FFF3E6')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 1.1
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs[0])

    def sun(name, color, strength, frm, angle):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.color = lin(color)[:3]
        ld.energy = strength
        ld.angle = math.radians(angle)
        o = bpy.data.objects.new(name, ld)
        COLL.objects.link(o)
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = (-Vector(frm)).to_track_quat('-Z', 'Y')
        return o

    # three.js (x, y, z) -> Blender (x, -z, y)
    sun('key', '#FFF0DC', 3.2, (3, -5, 5), 18)
    sun('fill', '#D9E4FF', 1.1, (-5, -3, 2), 30)
    sun('rim', '#FFE6F0', 1.6, (-2, 5, 4), 25)

    # camera: one fixed framing for every state, so frames never jump
    cam_d = bpy.data.cameras.new('cam')
    cam_d.angle = math.radians(22)
    cam = bpy.data.objects.new('cam', cam_d)
    COLL.objects.link(cam)
    sc.camera = cam
    target = Vector((.12, 0, 1.3))
    dist = (3.4 / 2) / math.tan(math.radians(11))
    pos = target + Vector((dist * math.sin(CAM_YAW), -dist * math.cos(CAM_YAW), dist * .06))
    cam.location = pos
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (target - pos).to_track_quat('-Z', 'Y')


def build():
    global COLL
    bpy.ops.wm.read_factory_settings(use_empty=True)
    COLL = bpy.context.scene.collection
    F = build_bean()
    make_book(F)
    make_glasses(F)
    make_laptop(F)
    make_signs(F)
    # blob shadow on the ground (Blender space)
    pm = _mesh('blob', [(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [(0, 1, 2, 3)], smooth=False)
    F.shadow = bpy.data.objects.new('shadow', pm)
    COLL.objects.link(F.shadow)
    pm.materials.append(blob_material())
    F.shadow.location = (0, -.05, .004)
    F.shadow.scale = (1, 1, 1)
    F.shadow_base = (1.05, .85)
    stage()
    return F


def set_shadow(F):
    k = F.shadow.scale[0]
    F.shadow.scale = (F.shadow_base[0] * k, F.shadow_base[1] * k, 1)


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['stills']
    F = build()
    what, names = args[0], [a for a in args[1:] if a != 'save']
    if what == 'stills':
        for n in names or list(STATES):
            pose(F, n, STILL_PH.get(n, .25))
            set_shadow(F)
            render(os.path.join(OUT, 'stills', f'{n}.png'))
    elif what == 'frames':
        # every clip as 512 px masters: out/frames/<clip>/NN.png
        for n in names or list(CLIPS):
            N, loop = CLIPS[n]
            for i in range(N):
                pose(F, n, i / N if loop else i / (N - 1))
                set_shadow(F)
                render(os.path.join(OUT, 'frames', n, f'{i:02d}.png'))
            if n in BLINKS:
                for i, b in enumerate((.08, .4)):   # shut, then half open
                    pose(F, n, 0.0, blink=b)
                    set_shadow(F)
                    render(os.path.join(OUT, 'frames', f'{n}-blink', f'{i:02d}.png'))
    if 'save' in args:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'bean.blend'))


main()
