---
version: 1
slug: "src-renderer"
primary_target: "src/renderer"
related_targets: []
---

## Scope

Crew Office window and the surfaces that share its world: Hire a pet, Pet settings, the roles upgrade notice, the chat panel. Mode: Operate.

## Audience and task

Technical and non-technical people watching their crew work, assigning tasks, joining meetings, and configuring pets. Non-technical users set the floor.

## Direction contract

THESIS: The crew is a 16-bit party with job classes, working in a modern pixel-art office. It refuses both the generic chat-sidebar assistant and the wooden, old-RPG office the first comp showed.

OWN-WORLD: Expressive 16-bit pixel characters. A contemporary office drawn in pixel art: pale concrete floor, glass-walled meeting rooms, white desks with monitors, plants. Interface chrome is crisp and modern: deep ink navy shell, off-white panels, gold for selection and attention, one colour per job class. Pixel type only on pet names, job classes and room labels; everything else in a clean sans.

STORY: The user sees at a glance who is free, working, in a room, or needing them; reads any meeting; assigns a task; joins a meeting.

FIRST VIEWPORT: Top bar with office name, assign input and Assign button. Left: party list (sprite, name, job class, status icon plus word). Centre: the pixel office map, desks and two glass meeting rooms. Right: the selected meeting's thread, a segmented call meter, and a join input.

FORM: Party Menu, my first-ranked candidate (picked over the roll's assignment), seed e3ec3a13, office modernised at the user's request.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

2D only, no 3D or WebGL. Sprites at integer scale on one canvas, 8–12 fps, paused when the window is hidden; a still-office setting and reduced-motion support.

## Unresolved

Comp round pending: image generation quota exhausted for the day.
