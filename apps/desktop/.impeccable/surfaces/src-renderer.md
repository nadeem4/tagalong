---
version: 1
slug: "src-renderer"
primary_target: "src/renderer"
related_targets: []
---

## Scope

Home (formerly the Crew Office: fixed chrome around a themed centre scene, the Office first) and the surfaces that share its world: the activity view, agent controls, the roles upgrade notice, the chat panel. Mode: Operate.

## Audience and task

Technical and non-technical people watching their crew work, assigning tasks, joining meetings, and configuring pets. Non-technical users set the floor.

## Direction contract

THESIS: The crew is a 16-bit party with job classes, working in a modern pixel-art office. It refuses both the generic chat-sidebar assistant and the wooden, old-RPG office the first comp showed.

OWN-WORLD: Expressive 16-bit pixel characters. A contemporary office drawn in pixel art: pale concrete floor, glass-walled meeting rooms, white desks with monitors, plants. Interface chrome is crisp and modern: deep ink navy shell, off-white panels, gold for selection and attention, one colour per job class. Pixel type on pet names, job classes, room labels, the office title and short panel headings; everything else in a clean sans.

STORY: The user sees at a glance who is free, working, in a room, or needing them; reads any meeting; assigns a task; joins a meeting.

FIRST VIEWPORT: Top bar with office name, assign input and Assign button. Left: party list (sprite, name, job class, status icon plus word). Centre: the pixel office map, desks and two glass meeting rooms. Right: the selected meeting's thread, a segmented call meter, and a join input.

FORM: Party Menu, my first-ranked candidate (picked over the roll's assignment), seed e3ec3a13, office modernised at the user's request.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

2D only, no 3D or WebGL. Sprites are DOM elements drawn with box-shadow at integer scale, animated by stepped CSS animation (no per-frame JavaScript); a Still office toggle and reduced-motion support stop it.

## Unresolved

Built code-led for this surface at the owner's request on 2026-10-07: 'go with C, build it in code' (image generation quota was exhausted). The standing default in .impeccable/config.json stays comp.
