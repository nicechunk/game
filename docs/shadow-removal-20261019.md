# Complete no-shadow gameplay policy

The earlier `shadows: false` policy removed projected meshes, directional blocker
rays and character shadow draws. It still baked diffuse sky visibility into
terrain vertices, including dark roof/wall/cave regions. The fragment shader also
multiplied non-water colors by the shared AO attribute. This did not meet the
request to remove visible shadows and their computation.

Gameplay now removes sun and sky occlusion together. Proven emitter-free terrain
uses constant unoccluded light without reading cells/columns or allocating any
light transport fields. Dense/custom terrain retains additive local-light
transport when emitters cannot be ruled out, but never queries sky blockers.
No-shadow jobs omit column-top halos and downward sky dependency invalidation.
Local source edits still invalidate nearby sections, and geometry/tree and
collision dependencies are preserved.

Both solid and detailed-water programs compile a no-occlusion shader variant.
It ignores old sun/sky masks and non-water AO even if stale vertex buffers are
present. Original normal-based oblique sun lighting, material detail, local
emission, sky, clouds, animated detailed water, water-depth data, texture filtering,
particles, resolution and DPR remain. Water shares the AO byte as a depth channel;
that channel and its animated shading must not be cleared when removing AO.

Enclosed caves and rooms no longer become dark from sky/sun occlusion when this
mode is active. Standalone engine callers with shadows enabled keep the existing
occlusion behavior. The published change is scoped to the game runtime; unrelated
pages, forging and common published engine files are preserved by hash checks.

Regression coverage includes roof/cave geometry, additive emission, zero shadow
queries and transport allocations, unchanged water-depth bytes and geometry,
actual source and packaged Workers, stale vertex-mask pixel comparisons,
normal-based sun response, native context restoration and identical detailed
water images. Software GPU checks do not establish real-device FPS.
