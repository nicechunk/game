# Gameplay without cast shadows

The user requested removal of projections to reduce stutter. Gameplay now passes
`shadows: false` to both the chunk manager/Workers and the WebGL renderer.

Disabled work includes terrain height-field shadow sampling, directional cast
shadow rays, terrain/tree/plant/cactus/decoration projection meshes, terrain shadow
passes and avatar projected-shadow resources/draws. The Worker and synchronous
fallback use the same policy. Default standalone engine callers retain shadows
for compatibility; other published pages are not part of this scoped release.

The sun retains its oblique world direction for normal-based material shading.
Diffuse sky and local emissive transport remain, including sealed-cave darkness.
With cast shadows disabled, surfaces reachable by diffuse skylight receive the
basic directional material light without a solar blocker ray. This retains indoor
lighting boundaries without adding object shadow projections.

Clouds, detailed water, sun disc, textures, particles, resolution, DPR, clear air,
frame pacing and asynchronous GPU publication are preserved. No scene resolution
or visual feature other than cast shadows is reduced.

Validation covers absence of projection geometry, skipped solar rays, sealed
caves/local emission, actual Worker byte parity, native WebGL shadow resource and
pass suppression, context recovery, water and picking. Software WebGL and Worker
build timings do not establish hardware FPS or authenticated gameplay acceptance.
