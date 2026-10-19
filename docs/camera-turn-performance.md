# Camera activity and collision work

Camera-only orbit and first-person look count as render activity. Optional GPU
residency for off-camera meshes pauses until the real camera pose and projection
settle for 160 ms. Foreground uploads, chunk generation, physics and authoritative
synchronization keep their existing budgets.

The camera box sweep tests each candidate voxel once per synchronous sweep using
a bounded scratch visit grid. Only one released array, at most 64 KiB, is retained;
reentrant and oversized sweeps remain independent or use the original traversal.
The conservative near-plane enclosure, voxel slab tests, skin and fallbacks remain.

Loaded air queries bypass tree crown hashing only when every possible root column
is loaded and no trunk can occupy the queried voxel. Possible trunks and missing
root columns keep the complete query and original leaf-overlap order. Current edits
and supplemental colliders are always consulted.

These CPU changes preserve cloud/water rendering, resolution, view distance,
meshing and retained lighting. Hardware browser FPS still requires a device run.
