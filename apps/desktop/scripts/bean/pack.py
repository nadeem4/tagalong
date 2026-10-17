"""
Pack out/frames/<clip>/NN.png (512 px masters) into the app delivery set:
out/delivery/<clip>.webp (one horizontal strip per clip, 192 px frames) and manifest.json.
Also writes out/delivery-preview.webp, an animated grid of every clip, to check the motion.
Run: python pack.py
"""
import glob
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, 'out', 'frames')
DELIVERY = os.path.join(HERE, 'out', 'delivery')
PX, FPS, QUALITY = 192, 12, 85
ONE_SHOT = {'cheer', 'wince', 'idle-blink', 'listening-blink'}   # play once, hold the last frame


def main():
    os.makedirs(DELIVERY, exist_ok=True)
    clips, manifest, total = {}, {'frameSize': PX, 'fps': FPS, 'clips': {}}, 0
    for d in sorted(os.listdir(FRAMES)):
        files = sorted(glob.glob(os.path.join(FRAMES, d, '*.png')))
        frames = [Image.open(f).convert('RGBA').resize((PX, PX), Image.LANCZOS) for f in files]
        strip = Image.new('RGBA', (PX * len(frames), PX), (0, 0, 0, 0))
        for i, fr in enumerate(frames):
            strip.paste(fr, (i * PX, 0))
        path = os.path.join(DELIVERY, d + '.webp')
        strip.save(path, 'WEBP', quality=QUALITY, method=6)
        size = os.path.getsize(path)
        total += size
        manifest['clips'][d] = {'file': d + '.webp', 'frames': len(frames), 'loop': d not in ONE_SHOT}
        clips[d] = frames
        print(f'{d:16s} {len(frames):3d} frames {size / 1024:6.1f} KB')
    with open(os.path.join(DELIVERY, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f'total {sum(len(c) for c in clips.values())} frames, {total / 1024:.0f} KB')
    preview(clips)


def preview(clips):
    """Every main clip side by side, animated, on a light background (blink clips left out)."""
    names = [n for n in clips if not n.endswith('-blink')]
    cols = 6
    rows = (len(names) + cols - 1) // cols
    n_frames = 144   # 12 s, a whole number of loops for every clip length used
    out = []
    for t in range(n_frames):
        im = Image.new('RGBA', (cols * PX, rows * PX), (232, 234, 242, 255))
        for k, n in enumerate(names):
            fr = clips[n]
            i = t % len(fr) if n not in ONE_SHOT else min(t % 36, len(fr) - 1)
            r, c = divmod(k, cols)
            im.alpha_composite(fr[i], (c * PX, r * PX))
        out.append(im.convert('RGB'))
    out[0].save(os.path.join(HERE, 'out', 'delivery-preview.webp'), save_all=True, append_images=out[1:],
                duration=round(1000 / FPS), loop=0, quality=70)


if __name__ == '__main__':
    main()
