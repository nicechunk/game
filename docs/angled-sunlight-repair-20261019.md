# Angled sunlight repair

The world sun direction remains `[-0.72, 0.34, 0.62]`. The baked direct-light
visibility channel introduced for section lighting incorrectly reused the vertical
open-sky column test. Consequently, a roof blocked side-entering sunlight while a
wall beside a vertically open receiver could not block direct sunlight.

Direct sunlight now traverses opaque voxels towards the same fixed sun source as
the sky disc, material shading, water highlights and existing projected shadows.
The traversal visits each intersected voxel, including thin walls and roofs. A
finite trace ending under a ceiling remains occluded. Diffuse skylight and local
emissive transport keep their independent six-neighbour fields.

The maximum horizontal footprint remains 15 blocks, matching the existing baked
terrain shadow halo. Like those shadows, this is bounded local visibility rather
than a global shadow map. Cell-centre samples and existing vertex interpolation
retain the original mesh size and may soften sub-block boundaries. Immutable
Worker snapshots now include edited voxels across the entire footprint, not only
the previous eight-block diffuse halo. Lower section invalidation includes the
six-block solar rise. Old Worker revisions remain rejected.

Ray offsets are computed once, and column/solid reads are cached within the
section build. Interactive section builds remain in Workers. No per-frame ray
tracing, extra GPU texture, extra draw pass or geometry subdivision is added.
Clouds, full water effects, fog policy, resolution, frame pacing and deferred
upload behaviour are unchanged from 0.1.82.

Verification includes independent ray/box intersections, displaced roof shadows,
side-entering sunlight, unchanged diffuse transport, section seams, actual Worker
snapshot parity and native software WebGL receiving-surface comparisons. These
checks are not a hardware GPU or authenticated production gameplay acceptance.
