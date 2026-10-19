# Loading and light-work budget

Gameplay keeps `shadows: false`. The previous release disabled projected meshes,
solar blocker rays and shadow draw passes, but retained full six-neighbour light
transport and a complete mesher invocation for every vertical render section.

A controlled cold run at the previously reported terrain coordinates found 188
empty sections out of 207 across nine chunks. Empty layers still reconstructed
voxel/material data and allocated caches. The canonical generation-5 terrain now
uses its surface/water profile, the full one-cell boundary height halo, tree owner
sections and all local/adjacent edit candidates to identify provably empty layers.
Those layers still commit empty results with their ordinary section revisions,
but perform no voxel reconstruction or cache allocation. World-bottom faces,
cliffs, water, decorations, trees, edited caves and floating blocks remain covered.
Custom/dense worlds retain the complete mesher path. Mutable access reuse observes
world version changes; Worker access and plans are task-local snapshots.

The same canonical generator has no native emissive blocks. An immutable edit
snapshot can prove that no local emitters exist. In that case an exposed sky seed
already has its final sky/local values and no longer recursively visits neighbours
or allocates transport state. Indoor/cave samples retain exact finite transport;
local emitters and unknown/custom worlds retain the full reference path. No lighting
approximation, lower-resolution rendering or view-distance reduction is added.

Validation compares complete packed vertices, light bits and topology against the
unoptimized path across generated terrain, boundary edits, caves, trees, water,
large/negative coordinates and emissive edits. Native software WebGL and CPU Worker
measurements are controlled checks, not hardware FPS or authenticated gameplay.
