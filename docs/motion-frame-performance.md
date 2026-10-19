# Game motion follow-up (0.1.90)

The frame loop polls `renderer.canPrepareFrame()` after gameplay and authority
updates. Deferred GPU callbacks skip visibility, building draw-list preparation,
upload admission and action-overlay construction, retain the last canvas, and
keep controls, collision, sync, effects and UI state advancing.

Current-view terrain and resources retain upload priority. Speculative
off-camera GPU residency pauses during motion and resumes when idle; CPU range
generation keeps running. Covered startup still requires complete current-view
CPU/GPU coverage before revealing the world.

Engine commits publish managed world bounds, cache stable priority order and
reuse per-entity animation buffers. See
`chunk.js/docs/motion-frame-performance.md` for the ownership and validation
contracts. No shared region arena or cross-section draw batching is introduced.

Fog and shadow computations remain off. Clouds, animated water, material detail,
resolution, view distance and existing gameplay fixes are retained. Performance
replays are controlled software/CPU evidence; real-device motion FPS remains a
separate acceptance step.
