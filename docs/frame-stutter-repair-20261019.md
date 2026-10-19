# Main-thread stalls and GPU frame backlog

## Baseline and scope

This repair builds on the full-quality 0.1.81 source, including clear air, clouds,
animated detailed water, filtered material mipmaps, the original DPR limits and
corner-sampled wall lighting. Those settings and all fragment shaders are
preserved. Neither draw distance nor backing resolution is reduced.

## Changes

- Worker-enabled interactive frames no longer synchronously build nearby section
  geometry and lighting. An indivisible section build could exceed a 4 ms budget
  by hundreds of milliseconds. Nearby edits receive priority in the Worker queue;
  their replacements still require matching section revisions before publication.
  Explicit offline callers can request `synchronousNearField: true`.
- Voxel reads avoid consulting the authority clock when no remote hints exist.
  Actual hints retain their exact expiry, invalidation and authority behaviour.
- A camera frustum is prepared once per manager visibility pass. Committed
  section bounds are aggregated once, and empty sections are retired before
  expensive render traversal. Whole-Worker results update their summary once.
- Gameplay enables `deferredChunkUploads`. Transfers stay staged until their
  completion fence is signalled and GL validation succeeds. Zero-time polls never
  deliberately block the main thread. Old handles survive errors, partial uploads
  and superseded revisions. Avatar registration cannot consume a staged batch's
  GL errors. Context loss, pruning and disposal release owned stages and fences.
- The last committed scene is submitted before sealing a new upload batch. A
  maximum of two in-flight GPU frames prevents a backlog of old camera positions.
  Input and physics continue during deferred callbacks. The FPS counter counts
  submitted frames, and deferred callbacks do not inflate the adaptive budget.

Deferred upload validation is opt-in for engine consumers; ordinary synchronous
upload APIs and their allocation/error behaviour remain available. A pending
upload can delay the visibility of an edit until the matching Worker result and
GPU completion arrive. It cannot publish a partially transferred resource.

## Verification boundaries

The deployment evidence is kept in `/workspace/render-stutter-fix-20261019`.
Performance probes use native SwiftShader WebGL with the same original effects,
camera, DPR, textures, deterministic world and nearby edit workload on both sides.
Warm comparisons wait for all 81 resident chunks and the visible GPU uploads to
settle before measuring. They distinguish animation callbacks from submitted
draws. These measurements cannot establish hardware GPU FPS or authenticated
production gameplay performance.

The earlier experiment that only deferred validation allowed a long queued-frame
backlog; its raw measurements remain in the task evidence as rejected work.
Cold streaming also loads more geometry sooner after the repair, so its FPS is
not used as a fixed-geometry performance comparison.
