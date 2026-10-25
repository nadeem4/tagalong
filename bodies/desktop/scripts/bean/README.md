# Bean: regenerating Scout's dock frames

Bean, the 3D Scout on the dock, is pre-rendered. The app ships one WebP strip per clip and a
`manifest.json` in `bodies/desktop/src/renderer/src/bean/`. These two scripts make them:

- `bean.py` builds the model, poses and clips in Blender, headless, and renders 512 px masters.
- `pack.py` scales the masters down to 192 px frames (twice the 96 px window, for HiDPI), packs
  each clip into one horizontal strip (lossy WebP q85 with alpha) and writes `manifest.json`
  (`{ frameSize, fps, clips: { name: { file, frames, loop } } }`).

## Steps

Needs Blender on the PATH and Python 3 with Pillow.

```sh
cd bodies/desktop/scripts/bean
blender -b -P bean.py -- frames          # every clip, masters in out/frames/<clip>/
blender -b -P bean.py -- frames working  # or only the named clips
python pack.py                           # strips and manifest in out/delivery/
cp out/delivery/*.webp out/delivery/manifest.json ../../src/renderer/src/bean/
```

`out/` holds the masters and is gitignored. Never commit the masters or a `.blend` file.

## Rules the app relies on

- One fixed camera for every clip, so Bean never jumps when the mood changes.
- 12 fps. Loop lengths vary per clip; the app reads them from the manifest.
- `cheer`, `wince` and the blinks are one-shots (`loop: false`) and end on a frame that holds.
- Each `<mood>-blink` clip is rendered from frame 0 of that mood's loop: the dock starts a blink
  when the loop comes back round to frame 0, so nothing jumps.
- A new clip the dock should draw needs its name in `bean-figure.ts` and in `DockPet`'s `BeanFigure`.
