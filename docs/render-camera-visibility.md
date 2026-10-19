# Camera, visibility, distance and DOM label policies

## R02: continuous safe camera placement

The camera collision primitive sweeps a conservative world-axis box by testing an exact ray against expanded voxel AABBs. DDA visits only candidate neighborhoods; it is not a set of sampled rays. There is no unchecked minimum-distance zone. A blocked sweep origin is explicitly `safe: false`; a supplied fallback must itself pass the volume test.

The motion controller derives a radius containing the eye and all four near-plane corners from the current near distance, FOV and aspect. It sweeps from a verified player head/body anchor to the smoothed focus, then to the requested/interpolated eye. Contraction is immediate, while unobstructed outward recovery stays smooth. Both first and third person use the same safety check. A newly blocked focus falls back to a verified player eye/body position or a still-valid last safe camera. `camera.cameraSafety` exposes `safe`, `radius`, `focusClipped` and `fallback`; a fully enclosed invalid player state is reported unsafe, not silently accepted.

The enclosure is deliberately conservative, and can pull the camera closer at corners than the former nine-ray disk. Camera origins and near-plane points are checked separately in the regression oracle. Purely vertical look targets use a nonparallel up axis in the real view matrix.

## R15: projection and committed geometry bounds

`renderer/frustum.js` extracts six planes from the actual camera view-projection matrix. It tests a world-space 3D AABB relative to the camera's integer origin. Mesh, visual mesh and committed render sections contribute bounds, including model/plant extensions beyond the nominal chunk. Packed vertices use their per-vertex positive scale and optional mesh Y origin. Explicit `mesh.bounds` or `chunk.renderBounds` avoids scanning; scans are weakly cached by committed mesh and vertex-array identity/revision. Unknown bounds stay visible.

The manager uses `chunkIntersectsCameraFrustum(chunk, camera)` as its conservative prescreen. There is no earlier horizontal yaw cone that can discard a chunk before the actual frustum test. Legacy building sphere metadata remains a conservative fallback. Sphere-only legacy tests were updated to require actual AABB intersection when mesh bounds are available.

## R16 and Q02: live view range and fog

`currentViewDistance()` is the runtime source for terrain, buildings, discovery and render radius. Foundation and building sync accept `getViewDistance` and `getPreloadMargin`; range participates in refresh context identity. A range change bypasses the ordinary refresh TTL, and stale foundation results cannot replace a new context. Async network completion remains dependent on the chain loader's existing timeout behavior.

`play-view-distance.js` computes camera far and fog using the effective render radius, actual camera horizontal offset and the largest completely committed CPU terrain ring. Ring inspection runs at most four times per second; intervening player displacement reduces the cached safe radius immediately. It is a loading-edge policy, not a substitute for geometry correctness. The default fog starts at 62% of its eye-depth horizon. A quarter-chunk world margin and the current FOV/aspect corner cosine keep even screen corners inside the loaded radius. Near-zero startup horizons use a four-block minimum. Camera far keeps the existing sky/sun pass available. Water blending may shorten fog, never extend it past the current render horizon.

## Q04: name and chat occlusion

The default host policy is `solid`: both remote names and chat bubbles require an unobstructed voxel ray from the eye to the avatar head. A product/debug override `?nameOcclusion=none` intentionally permits through-wall labels. Occluders use the same terrain/building camera-occluder query as camera collision. No avatar is removed.

Candidates are filtered by distance and screen bounds. At most eight terrain rays are issued per frame, with a 150 ms cache interval. New/unverified targets stay hidden until checked. Oldest targets are serviced first, with near-first ordering among equal ages, and results over four intervals old are hidden. World edits can therefore take one cache interval to affect a label under normal load. A single canvas layout read and all projections/terrain queries precede DOM writes.

## Reproducible verification

- `node --test chunk.js/tests/camera-{collision,volume-safety}.test.mjs chunk.js/tests/frustum.test.mjs`
- `node --test play/tests/camera-tunnel-safety.test.mjs play/tests/first-person-camera.test.mjs play/tests/mobile-joystick-camera.test.mjs play/tests/player-building-collision.test.mjs`
- `node --test play/tests/{view-distance-sync,view-environment,play-name-chat-overlay,onchain-building-discovery}.test.mjs`
- `CAMERA_EVIDENCE_DIR=/path/to/evidence node play/tests/render-camera-visibility-browser.mjs`

The targeted gate contains 91 tests, including delayed foundation and building responses after shrinking the view range. Node trajectories cover 8,100 frames across 15/30/60/120 FPS, variable dt, standing/walking/29.6-block-per-second sprinting, desktop/mobile dimensions, L/zig passages, first/third-person switches, changing ceilings and vertical ledges/drops. Browser fixtures add 1,350 frames and real DOM wall/doorway assertions at desktop and portrait dimensions.

The available Chromium renderer is SwiftShader. The camera/DOM browser fixture does not boot the authenticated game and does not render a real game-world GPU scene; it is not hardware GPU, production Guardian, or a 60-minute end-to-end validation. Refer to the broader render-repair evidence for those independently tracked gates.
