# World startup visibility and render performance

The rendering release could reduce fog distance to four blocks while waiting for
a complete square ring of generated chunks. At a chunk-boundary spawn the loaded
radius is zero, even after terrain in the player's view has been committed. A
third-person camera roughly eight blocks behind the player then fogs out the
already rendered world. CPU-visible sections also included empty or not-yet-uploaded
geometry, allowing the startup overlay to disappear without an actual terrain draw.

Gameplay now uses the configured view-distance fog policy through
`computePlayViewEnvironment`. Transient streaming gaps do not move fog in front of
the player. The generic loaded-radius helper remains available for diagnostics.
The renderer reports uploaded, drawable sections; startup completion requires an
actual opaque/cutout terrain draw rather than sky or pending CPU meshes.

Two render-path costs were addressed without changing view distance, DPR, world
generation, culling, transparency sorting or authoritative data rules:

- Worker dispatch reconstructs unchanged generated column tops in the Worker.
  It captures the exact edited tops in a sparse immutable snapshot. Dense custom
  bases retain the complete snapshot path. This removes 2,116 generated-column
  reads from each ordinary main-thread dispatch. Real Worker regressions compare
  complete mesh bytes against the original dense snapshot, including distant
  shadow edits and changes after capture.
- Opaque, cutout and shadow material partitions use a shader specialized for
  solid terrain. Fluid/noise code stays in the existing blended shader. Both
  programs receive the same frame lighting and camera state and participate in
  context restoration and disposal.

## Controlled verification

The detailed records live under `/workspace/render-loading-fix-20261019/evidence`.
The full-height graphical probe uses the real ChunkManager, four real module
Workers, production render budget and renderer, default seed, view 7 / preload 2,
and a 640x360 SwiftShader canvas near the default spawn at (800,800). It is a local
deterministic scene, without wallet authentication or live chain state.

The first mesh arrived at 1.447s before and 1.880s after. The first rendered frame
with fog distance above 16 blocks occurred at 21.152s before and 1.887s after.
The captured early images show the old white terrain and the corrected material
colors. Scene frame work retains long tails on the software backend; these are
not hardware FPS or a guaranteed frame deadline. Screenshot/readback drain time
is included in the separate probe wall duration, not the individual frame samples.

The independent paired GPU query fixture uses identical native GPU triangle
readbacks, camera, viewport and draw count, with 60 measured samples per side,
scenario and texture policy. All 720 measured queries and 80 warmups were valid.
At the default texture policy, steady GPU draw P50/P95/P99 changed from
290.378/294.681/301.810ms to 93.569/100.146/186.261ms. Both texture-policy warmup
screenshots were pixel-identical (230,400 pixels each). This is actual elapsed
WebGL query timing on ANGLE/SwiftShader, not a hardware GPU or universal FPS claim.

The complete query import closure was rehashed against the final source. The
separate generated browser/Worker bundles were regenerated afterward and are
checked by the normal engine/build gates.
