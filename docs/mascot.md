# Mascot engine

`bodies/mascot` (`@tagalong/mascot`, private, never published) is the WebGL engine that draws Scout as a
live 3D character. The desktop dock draws Scout with it (see [Scout on the dock](#scout-on-the-dock)).

## Where it comes from

A fork of the wobnimo 0.2.0 mascot engine, MIT licensed. The licence notice stays
in `bodies/mascot/LICENSE`, and every file that derives from wobnimo says so in its header. The fork lives
in the repo (not as a dependency) because Tagalong adds to the engine's core: per-mood parts, custom moods
and props. Files new in the fork (`props/`, `runtime/moods.ts`) say they are not from wobnimo.

## How it works

A character is a plain-data spec (`CharacterSpec`): materials, bones, shaped parts, eyes, a face, anchors,
acting per expression and effects. `compile` turns a spec into one fragment shader (the body is
ray-marched on the GPU) and a rig; `Mascot` runs the loop (`Brain` picks the pose, `Rig` poses the bones,
`Fx` emits particles, the renderer draws).

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#ffffff','primaryTextColor':'#000000','primaryBorderColor':'#000000','lineColor':'#000000'}}}%%
flowchart LR
  spec[CharacterSpec] --> resolve[resolve: validate names, moods]
  props[attachProps] --> spec
  resolve --> compile[compile: shader and rig]
  compile --> mascot[Mascot]
  mood[setState mood] --> mascot
  mascot --> brain[Brain: pose and face]
  mascot --> parts[part scales on a spring]
  brain --> render[WebGL2 renderer]
  parts --> render
```

## Moods

The built-in states are `idle`, `thinking`, `listening`, `speaking`, `sleeping`, `working`, `error`,
`surprised`, `celebrating` and `sad`. `happy` is the short reaction to a poke, not a state you set.

A spec can add its own moods, which inherit a built-in state and override bits of its face:

```ts
const spec = {
  // ...
  moods: {
    coding: { base: 'working', face: { glow: [0.2, 0.9, 0.4] } },
    nap: { base: 'sleeping' },
  },
};
mascot.setState('coding');
```

A mood plays its `base` state (face, acting, effects). `face` replaces any of the base state's face
targets (`lid`, `squint`, `smile`, `tilt`, `energy`, `flap`, `glow`, `exposure`, `wide`, `asym`).
`resolve` rejects, with the character and field named: a base that is not a state, a mood named like a
built-in state, a part shown in an unknown mood, and a part with an empty `moods` list.

## Parts visible per mood

A part with `moods: ['coding', 'thinking']` shows only in those moods (names of built-in states or of the
spec's moods). It scales in and out on a slightly underdamped spring about its `pivot` (default its `at`),
so it grows with a small overshoot and shrinks without popping. Under reduced motion it jumps to its
final scale. The maths is in `src/props/visibility.ts`, kept pure so it is tested without a GPU.

## Props

A prop is a data file in `src/props/` (a `PropSpec`): its own materials, optional bones, parts in its own
space, and optional acting for its bones. `attachProps(spec, [[prop, attach]])` hangs each prop on a
character bone and returns a new spec; the original is untouched.

```ts
const scout = attachProps(base, [
  [lightbulb, { bone: 'head', at: [0.4, 0.9, 0], moods: ['thinking'] }],
  [laptop, { bone: 'body', at: [0, 0, 0.5], scale: 0.8, moods: ['working'] }],
]);
```

`PropAttach`: `bone` (where it hangs), `at` (its origin in that bone's space), `scale`, `moods` (where it
shows) and `colors` (recolour its materials by local name). A prop's materials join the character as
`name.material`. Props may not carve (`op: 'sub'`), since a carve would cut the body.

The library: `laptop` (its lid opens while `working`), `desk`, `lightbulb`, `tablet`, `notepad`,
`headphones`, `pillow`, `nightcap`, `partyHat`, `wrench`. Confetti is not a prop but the built-in `celebrating` effect.

## Public API

From `@tagalong/mascot`: `mount(element, spec, options)` or `new Mascot(canvas, spec, options)`, then
`setState(mood)`, `setPalette`, `setSpec`, `poke`, `on('ready' | 'poke' | 'state')`, `dispose`;
`attachProps`, the props, `recolor`, `variant`, `defineCharacter`, `isSupported`, `warm`. React:
`@tagalong/mascot/react` exports `Mascot` (`character`, `state`, `status`, `palette`).

## Build and test

`pnpm --filter @tagalong/mascot build` (plain `tsc -b`, run by `pnpm build` too) and
`pnpm --filter @tagalong/mascot test` (vitest in node; the tests cover the pure logic, no WebGL).

## Scout on the dock

Scout is wobnimo's Volt recoloured gold, navy and sky, with a sky chest lamp. The character spec is
`bodies/ui/src/mascot/scout.ts`. `DockPet` renders `ScoutFace` (`bodies/ui/src/scout-face.tsx`), the
engine's `<Mascot>` in a 96 px box: not interactive, pixel ratio capped at 1, fading in when ready.
`MOOD_STATE` (`bodies/ui/src/mascot/mood-states.ts`, pure and tested) maps a dock mood to the engine's:
`dozing` becomes `sleeping`, the rest keep their name. Every other place Scout appears (chat lines, Home's
nav tile, the tour's side panel) is the still SVG head `ScoutGlyph` / `ScoutMark` (`scout-mark.tsx`), so
no WebGL canvas is created per chat line.

The renderer reducer (`bodies/desktop/src/renderer/src/dock.ts`, `nextDock` and `dockMood`) picks the
mood. Priority, highest first: a flash, seeing, reading, speaking, thinking, working, a drop hover,
dozing, idle.

| Mood          | Trigger                                                                                                                                                   | Prop                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `idle`        | nothing going on                                                                                                                                          | none                |
| `listening`   | the mic is open, or Seeing                                                                                                                                | headphones          |
| `reading`     | a screen-reading tool runs (`list_windows`, `read_window_text`, `look_at_window`)                                                                         | tablet              |
| `thinking`    | a turn started                                                                                                                                            | lightbulb           |
| `speaking`    | Scout's voice is playing (the panel player's `speech_state`, mirrored by main to every window as `tagalong:voice:speaking`, `onSpeaking` on the host API) | none                |
| `working`     | an expert job is running (`listJobs`, refetched on `onBrainChanged('jobs')`) or a background turn                                                         | laptop and desk     |
| `dozing`      | the person is away (the engine's `sleeping`)                                                                                                              | nightcap and pillow |
| `celebrating` | a job finished (running to done), a flash of about 2.2 s                                                                                                  | party hat, confetti |
| `error`       | a job failed, or a turn errored (including a brain restart), a short flash                                                                                | wrench              |
| `surprised`   | Scout speaks up on its own (`pet.remark`), a short flash                                                                                                  | none                |
| `sad`         | a job stopped, or a turn was cancelled, a short flash                                                                                                     | none                |
| `happy`       | the person clicks Scout, a short flash                                                                                                                    | none                |

Not wired yet: an install-finished celebration (no install-finished signal exists) and a distinct
signal for an urgent interjection (`pet.remark` is used for `surprised`).

The engine breathes and blinks on its own, so the dock has no frame or blink logic, and the dock has no
reduced-motion handling for it.
