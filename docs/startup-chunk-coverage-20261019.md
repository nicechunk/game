# Initial terrain coverage and loading work

Baseline: application 0.1.87, runtime `play-bundle-0164c5f320cecf81`.

The user confirmed that movement and loading improved, then reported transparent
patches during initial streaming and requested faster loading at the same
quality. First terrain draw and complete initial coverage are separate metrics.

## Scheduling

- Start the bounded terrain Worker pool after renderer setup. It overlaps the
  asynchronous avatar load; preferred pool sizing still reserves CPU capacity
  for the main thread.
- Keep the immediate neighborhood and the current camera frustum ahead of
  offscreen streaming. Camera snapshots include target, sub-block offsets,
  projection and eye position; turning reprioritizes queued work. Committed
  bounds invalidate the visibility cache. Background identities and eventual
  builds remain; nearby edit priority and queue aging remain active.
- Build priority and readiness use the same camera-target chunk radius as
  rendering, including sub-block offsets. A target crossing a chunk boundary
  must not classify a visible edge row as an offscreen preload row.
- If authority/material inputs supersede an unpublished first base, retry its
  latest snapshot in one complete Worker batch. Reuse its canonical profile;
  do not split the initial retry into 23 height-layer round trips. Published
  worlds keep the normal incremental section remesh and old visible handles.
- Do not infer startup upload throughput from the FPS of compilation/deferred
  frames. Retain the upload CPU deadline, byte limit, zero-time fence polling,
  retry behavior, atomic commits and two-frame GPU queue bound.

## Work removed

- In canonical generation v5, buried base blocks are opaque and unedited columns
  only expose their surface to ground decorations. A candidate mask skips their
  rejection in the visual scan. Visual edits, water segments, arbitrary edited
  floors and custom/dense terrain retain their complete paths and emission order.
- Cache retirement of committed empty GPU channels by mesh, revision and context
  generation. Repeated frame scans do not repeat map/key cleanup for every empty
  height layer. New geometry and later empty commits still retire old resources.
- After a GPU upload batch validates, prepare the next bounded batch in the same
  callback. Finish nearer section channels before distant opaque geometry. Draw
  order is unchanged; no submission occurs behind an outstanding validation fence.
- While the existing opaque loader covers the world, validate uploads without
  drawing the hidden partial scene. As soon as coverage is complete, render the
  full scene and let the loader release its existing startup holds. A hidden
  loader or RPC dialog never suppresses normal rendering.

## Initial readiness

The first partial terrain draw cannot release the loading screen. Initial
readiness requires the immediate base neighborhood and current visible columns
to have complete initial section commits. Every nonempty visible terrain/water
channel must refer to the current validated GPU mesh. The preload ring and
offscreen GPU channels do not delay entry. An actual submitted terrain frame is
also required. This check stops after initial coverage; movement keeps its normal
streaming and upload budgets.

Clouds, detailed animated water and depth bytes, textures, normal-based sunlight,
particles, resolution/DPR, the no-fog policy and disabled shadow calculations
remain. No scene simplification or reduced view distance is used.

## Verification boundary

Use sequential cold/warm controlled replays and complete mesh/pixel comparisons.
Native software WebGL demonstrates ordering and correctness, not the user's
hardware frame rate. An authenticated user world and actual device loading time
remain field acceptance items. Deployment evidence and rollback are retained
outside the source repository in the task directory.
