# Gameplay without cast shadows

The user requested removal of projections to reduce stutter. Gameplay now passes
`shadows: false` to both the chunk manager/Workers and the WebGL renderer.

Disabled work includes terrain height-field shadow sampling, directional cast
shadow rays, terrain/tree/plant/cactus/decoration projection meshes, terrain shadow
passes and avatar projected-shadow resources/draws. The Worker and synchronous
fallback use the same policy. Default standalone engine callers retain shadows
for compatibility; other published pages are not part of this scoped release.

The sun retains its oblique world direction for normal-based material shading.
The no-shadow policy also removes baked diffuse sky occlusion and terrain AO.
Roofed surfaces and sealed caves receive the same unoccluded sky/sun inputs as
outdoor surfaces with the same normal. Local emissive light remains additive.
Canonical terrain without emitters skips all light-cell and transport allocation.
No sky-column snapshot or downward sky invalidation is prepared in this mode.
The compiled shader ignores old sun/sky/AO masks so stale mesh data cannot restore
an occlusion patch. The shared AO attribute still carries water depth unchanged.

Clouds, detailed water, sun disc, textures, particles, resolution, DPR, clear air,
frame pacing and asynchronous GPU publication are preserved. No scene resolution
or visual feature other than cast shadows is reduced.

Validation covers absence of projection geometry, skipped solar/sky occlusion,
unoccluded rooms/local emission, actual Worker byte parity, native WebGL shadow resource and
pass suppression, context recovery, water and picking. Software WebGL and Worker
build timings do not establish hardware FPS or authenticated gameplay acceptance.
