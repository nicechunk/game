# Movement frame cost repair

The user reported about 54 FPS while stationary and 15 FPS while moving. The
baseline is deployed 0.1.86, with fog and shadows disabled and full cloud/water
quality. No hardware recording or authenticated session trace was available.

## Confirmed avoidable work

1. Focus, desired-camera and smoothed-camera sweeps repeatedly read the same
   world voxels during one synchronous camera update. A per-call query cache now
   shares these reads and clears before every subsequent call. Changed terrain,
   moving actors, near-plane safety and tunnel/ledge collision rules remain exact.
2. Avatar synchronization still queried ground height for a projected shadow
   after the renderer and terrain Workers disabled shadows. Gameplay now passes
   its shadow policy into the motion controller and skips that lookup.
3. Hidden avatar equipment is represented by collapsed zero-alpha triangles.
   These entered the depth-sorted transparent queue and incurred one submission
   per invisible triangle. Zero-alpha untextured triangles now skip the queue.
   Textured materials remain eligible because their texture can override vertex
   alpha. Partly transparent triangles remain eligible too.
4. Adjacent transparent terrain ranges already have identical handle, origin,
   opacity and state, but often have discontiguous indices. Optional native
   `WEBGL_multi_draw` submits those ranges in their existing sorted order.
   It never crosses an avatar, particle, preview, different origin or handle.
   The ordinary draw path is retained and verified when the extension is absent.
   Context initialization/restoration reacquires the extension and scratch arrays.

No shader, resolution, DPR, material, texture, cloud or water downgrade is used.
The guarded GPU upload validation and two-frame queue limit are unchanged.

## Verification

- A deterministic 360-update walking fixture at the supplied X/Z coordinates
  uses the production motion controller and 441 ready base chunks. Camera blocker
  reads fall from 87,732 to 12,363 with the same player trajectory. Idle and turn
  cases are measured separately. Instrumented CPU times include query counters
  and profiler cost; these are not hardware FPS.
- Five fixed camera/walking/avatar poses have identical native software WebGL
  pixels against 0.1.86, including cloud/sky, detailed water, terrain and trees.
  The reference scene uses 320 submissions; the new path uses 6, and the ordinary
  fallback uses 20. The 300 removed triangles are invisible equipment. Complete
  terrain Worker vertex/index hashes, including lighting and water depth, match.
- Camera voxel queries are unique within a call, terrain edits are observed on
  the next call, and tunnel/near-plane safety passes. Ordered range and hidden
  equipment tests cover extension/fallback and textured alpha overrides.
- A larger view-7 software GPU exploratory run is retained separately. It did
  not reproduce the user's exact 54-to-15 transition, and some early profiling
  overlapped other CPU work. These exploratory runs do not establish an FPS gain.

Actual device/browser loading and movement FPS remain field acceptance items.
