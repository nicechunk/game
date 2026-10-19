# Clear-air visual quality and rendering efficiency

Gameplay retains the original cloud layer, sky gradient, sun disc, detailed water,
projected shadows, filtered material mipmaps and particle capacity. Default engine
DPR limits apply again; the 921,600-pixel gameplay cap has been removed. Distance
fog and horizon haze remain absent. HUD layout and CSS pointer coordinates retain
their existing behavior.

The quality settings are in `play/play-render-options.js`. Normal gameplay opts
out of continuous GPU timer queries; `gpuTiming: true` is still available when
constructing a renderer for diagnostics. CPU frame statistics remain available.
Chunk uploads check allocation and transfer errors once per stage before handle
publication, reducing redundant synchronous driver round trips while preserving
failed-upload cleanup, previous handles and retry behavior.

Transparent primitives keep their global depth order. Consecutive compatible
terrain items reuse program, lighting, texture and vertex bindings. Only adjacent
forward-contiguous index ranges from the same handle, origin and opacity may be
combined into a draw. An intervening avatar, particle or incompatible preview
ends the run and invalidates cached state. No triangles are discarded or moved.

Detailed water skips the exact zero contribution of inactive sparkle cells and
water kinds/ranges where sparkle visibility is zero. Wave, sparkle, material,
alpha and lighting equations remain unchanged for visible effects.

Merged wall quads previously received one illumination sample at the face center.
This made a large wall crossing an overhang/window transition uniformly dark or
bright. Each existing corner now receives its own world-space illumination, with
the existing shader interpolants providing gradients. Adjacent sections sample
the same shared corners. Vertex/index counts and geometry are unchanged.

Finite six-neighbour sky/emissive transport is memoized by cell and remaining
distance. Dense whole-volume propagation and an independent per-corner traversal
oracle validate the same attenuation, occlusion, skylight and local-source rules.
This avoids independently revisiting the same air volume for adjacent corners.

Verification uses original 0.1.79 graphics with fog outside the scene as the
visual reference, fixed geometry/time/camera for material and transparent-order
comparisons, dedicated wall-lighting fixtures, and paired WebGL queries with the
same full-quality settings on both sides. Software WebGL measurements do not
establish hardware-device FPS or authenticated production-session performance.
