# Terrain streaming performance (0.1.89)

Starts from the deployed 0.1.88 source. The resource-rule RPC begins during boot,
concurrently with renderer/avatar/world preparation, instead of waiting for the
first visible terrain. No unverified persistent rule table is used.

The engine refreshes affected resource sections without remeshing terrain,
batches section requests and retains eligible clean evicted meshes under a byte
limit. Ground pickup masks survive chunk unload and reject stale cache matches.

Once the initial current view is complete, the Game supplies the resident CPU
ring separately for bounded background GPU preparation. The draw input remains
restricted to current visibility. CPU/upload-byte budgets and GPU queue limits
remain active. Streaming backlogs keep a small upload floor even when deferred
frames lower sampled FPS. Covered startup retains its full-coverage gate.

Fog/shadows stay disabled. Clouds, full animated water, textures, particles,
normal lighting, DPR/resolution, view distance and gameplay stay unchanged.

Validation covers real Workers, rule arrival/pickups/caves, revision races,
negative boundaries, empty commits, memory limits, GPU failure/recovery and
extension fallback. Controlled software-GPU timings are not device FPS or
real authenticated-session loading times. Full deployment evidence is retained
with the release artifacts outside this source checkout.
