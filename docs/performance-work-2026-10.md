# Rendering and resource streaming work record

Baseline: Game `cdb0130a399757aee66dd355b700e48394aa4228`; Chunk.js `0609585afb10bb3f6d2ec047c9e4b5a63c458e9e`; deployed application 0.1.94.

Use the current application branch rather than reverting to the older audit baseline. Preserve the existing chunk.js submodule integration and existing gameplay fixes. Commit author and committer: nicechunk.

## Task matrix

| Task | Status | Evidence |
| --- | --- | --- |
| R1 | implemented, focused checks passed | Hidden part metadata excludes known hidden ranges; textured alpha-zero triangles remain visible. |
| R2 | implemented, native checks passed | Sorted dynamic EBO segments preserve effective order, UInt16/UInt32, shared rebasing, isolated VAO and bounded fallback. |
| R3 | implemented, native checks passed | Contiguous sorted particle segments share one upload and correct instance attribute offsets. |
| R4 | implemented, native checks passed | Persistent double-buffered per-entity poses; interleaved actors upload each pose once, with static model ownership preserved. |
| M1 | implemented, oracle checks passed | Unchanged empty neighbor lighting dependencies no longer dirty unrelated underground sections; effective light propagation remains covered. |
| M2 | implemented, lifecycle checks passed | Immutable captured world input, section revisions, instance identity, cancellation, deduplication and a bounded Worker watchdog. |
| M3 | implemented, fallback checks passed | Healthy Workers get near edits; snapshot/world/mesher/lighting fallback is resumable and spends the shared frame deadline. |
| M4 | implemented, actual packaged Worker passed | Progressive sections publish through the frame queue; Worker ownership persists through terminal plus packet consumption. |
| M5 | implemented, parity checks passed | Certified generated visual candidates avoid empty traversal; final-state geometry, light and pickup counterexamples remain covered. |
| M6 | implemented, parity checks passed | Numeric greedy groups, scalar packing and trusted internal world config; widths1/16/31/32/33/64 and randomized packing match original bytes. |
| U1 | implemented, managed-world checks passed | Preparation/render share visibility and viewport state; summary keys never materialize lazy whole-column arrays. |
| U2 | implemented, fairness checks passed | Opaque/visual uploads share bounded bytes/time/deadline, retain failure rollback and give aged visual work progress. |
| H1 | implemented, range checks passed | Full target union split into100-coordinate batches; per-coordinate/context TTL; SDK RPC<=100 accounts and concurrency<=4. |
| H2 | implemented, publication checks passed | Verified complete buildings publish independently; bounded frame application and background disk writes. |
| H3 | implemented, authority checks passed | Valid overlap/in-flight reuse; cache identity includes host world and SDK RPC/program/GlobalConfig context. |
| H4 | implemented, actual Worker parity passed | Canonical compact transfers preserve25,600 records and true pair slots; main validates rather than decoding/sorting again. |
| Q1 | implemented, browser checks passed | Hidden land UI skips lists/layout; snapshots/range caches preserve fresh activation, projection, focus and text input. |
| Q2 | implemented, browser pixel checks passed | Fine Worker/fallback share the exact terrain/relief iterator; coarse fallback also obeys deadline; bounded48 jobs and viewport pruning. |
| Q3 | existing behavior verified | Signature no-op, precise visual invalidation and rule/startup concurrency were already present; retained without duplicate rewrite. |
| Q4 | implemented, recovery checks passed | Cooperative parser/codec/placement/mesh/result validation; capped cooldown, watchdog, snapshot and duplicate/abort safety. |
| Q5 | implemented, startup checks passed | Extracted pure presentation helpers remove eager forge restoration; production manifest/Worker paths validated; access/CSS/locale gates retained. |
| E1 | existing arena retained and verified |64MiB shared GPU pages, exact16-bit addressing, optional multi-draw fallback, retirement and context restore; no whole-region rebuild. |
| E2 | measured CPU optimization implemented | NCM4 bone trig/static-face caches preserve exact pose bytes; further GPU animation has no target-hardware benefit evidence yet. |
| E3 | assessment complete; hardware measurement unavailable | Software GL can verify rendering and timer plumbing, not hardware raster cost. Resolution, view distance, water and clouds remain unchanged. |

## Progress

- Original attachment 1557 was downloaded and its SHA-256 verified.
- Isolated Game and engine checkouts created from current application source.
- Node 22.22.3, npm 10.9.8 and Chromium151 are available. Rendering uses SwiftShader under a2-core CPU quota; hardware GPU is unavailable.
- Frozen baseline engine:457 passed. Frozen baseline Game:512 passed, two failed, two skipped.
- Native WebGL checks:54 exact pixel/effective-triangle-order comparisons passed, including context recovery and zero retained native resources after disposal.
- Deferred production uploads:36 further exact native comparisons passed, including native error injection, six recoveries and pending-batch disposal. Focused async gate43/43 and lifecycle gate33/33 pass.
- Mesher focused gate:103 passed. Host focused gate:81 passed plus authority-context/browser checks.
- Controlled traces:2,000 contiguous transparent triangles use one draw;320 particles use one draw/upload; interleaved pose vertex transfer2.4MB becomes24KB plus sorted indices.
- Three paired400-chunk host runs preserve identical25,600-record state. Main event-loop active median894.686ms becomes108.372ms; wall1287.385ms becomes1267.321ms. Compact transfer array bytes increase28%.
- Warm CPU pose samples: NCM4 eight actors44.325ms becomes2.018ms;32 actors173.624ms becomes7.966ms, exact pose hashes preserved. NCM2 one-actor overhead rises0.020ms.

## Current checkpoint

- The baseline eager-forge startup failure is corrected under Q5. The other failure asserted superseded auto-tool selection; equipment removal succeeds, and the regression now asserts retained bare hands.
- Terrain Steps APIs preserve synchronous compatibility and yield during meshing, bounds, lighting, material partitioning, profile generation and snapshot preparation. Main-thread integration is covered by focused contract checks and the final packaged-Worker gate.
- Progressive Worker packets enqueue only; frame-budgeted commits retain ownership until terminal plus all accepted packets are consumed.
- The initial integrated replay exposed a moving/town wall-frame regression and was rejected before push or deployment. The profile-driven correction passes the final530/530 engine and549/549 Game checks. Corrected quiet ABBA pairs also pass, with all437 final chunk geometries identical. The final30min active residency also passes, with two context recoveries and zero native resources after disposal.
- Rendering/host counts and software GL timings are controlled evidence, not target-device FPS. Preserve original DPR/view distance, water/clouds, and disabled fog/shadows.

## Ownership and scheduling contracts

- The transparent stream owns a separate EBO/VAO, indexed from the committed material partition. Only consecutive equal program/storage/origin/opacity/material/pose states merge. Canonical opaque/cutout indices remain immutable.
- Each entity owns its pose output; aliases retain the shared static model/index resource. Dynamic shadow candidate caps are enforced independently of body visibility; production shadows remain disabled.
- Progressive messages enqueue data rather than publishing directly from message callbacks. Section dependency revisions and chunk instance identity gate each commit. Base data is adopted once; first transfer clones the Worker-owned profile.
- A task releases its Worker only after terminal status and accepted packet consumption. Cancelled synchronous computation is terminated before slot reuse; a30s watchdog resolves silent/incomplete protocols.
- Cooperative builds retain private output and immutable captured inputs. Invalid snapshots cancel rather than partially overwrite live data. Sync APIs drain the same generators for consumer compatibility.
- Foundation/building discovery keeps a full target union, separates wallet ownership refresh, and never treats failed reads as empty. Complete building records publish through a bounded queue; deletion/invalidity removes collision, while failed unchanged reads retain valid state.
- Raw rAF samples are separate from physics dt. State application, mesh publication and GPU preparation receive the same absolute deadline. Detailed counters appear only in the developer log.

## Known measured costs and limits

- Sorted transparency adds a dynamic index stream; per-entity poses add retained double-buffered CPU/GPU storage. Their capacities are tracked and disposal/context recovery tested.
- Numeric terrain changes improve warm heavy packing but a tiny flat generated mesh measured0.669ms to0.761ms; cold first calls can be slower. These results are disclosed rather than hidden by aggregate ratios.
- Native allocation/codec envelopes cannot be interrupted inside one platform call; surrounding voxel, lighting, mesh and validation work yields. Cooperative work-unit limits are not machine-specific sub-millisecond guarantees.
- Authenticated user gameplay, real-chain acceptance and hardware GPU/FPS remain separate from controlled browser fixtures. No production transaction is used for this performance verification.

## Integrated profile correction

- The controlled browser has a2-core cgroup quota and SwiftShader. CPU/wall stage quantiles cannot be subtracted or treated as hardware GPU throughput.
- The first complete before/after replay retained identical geometry in all437 chunks;89.1% of sections were empty. Physical transport now combines at most8 consecutive empty results, while logical section sequence/revision checks and one-section zero-budget consumption remain unchanged.
- Initial empty-to-empty section commits no longer recompute column summaries; nonempty publication and terminal completion still update the full summary. The final-state visual candidate owns its mask/edited-column summary, removing duplicate preparation.
- Actual Chrome CPU profiles identified synchronous pose-upload `getError` waiting, including1.606 seconds self time in the sampled town phase. Async validation now reuses the shared fence and preserves matching CPU/GPU fallback. Earlier draw-count reductions alone did not establish a smoothness improvement.
- The incomplete13.12min residency and first replay are retained as rejected evidence, not final passing gates. No source push or public deployment occurred for that candidate.
- Dynamic uploads add one validation-batch pipeline delay. An unverified first instance is temporarily omitted; changed sorted order uses exact canonical draws until validation, while equal verified order reuses the batch. Working/committed sorted CPU arrays share the8MiB cap.
- The repeated browser replay records both raw rAF and actual scene-submit intervals, counts submitted/deferred frames separately, and hashes all final section geometry. A high rAF callback rate cannot by itself establish visual throughput.

## Final build provenance

- The required whitespace review found one extra blank line at EOF in the new canonical chunk helper. Removing it changes no JavaScript tokens, but the content-versioned build was regenerated as `play-bundle-9fcdab8fc21f93e3`. The incomplete prior residency is archived and does not count as a final30min pass.
- The controlled benchmark fixes equipment to empty and uses phase-relative animation time. Earlier alternating-equipment replay metrics are retained as confounded diagnostic evidence and excluded from final timing claims. Residency still switches tools.
- The final production source snapshot contains310 build inputs. Documentation and test records can be completed later; product input bytes remain frozen.

## Verification environment correction

- The first final Game attempt used explicit test concurrency2 while active SwiftShader residency also consumed the2-core quota. The unchanged market UI fixture timed out waiting for a stable clickable card; that failed/incomplete attempt is retained. The required full suite reruns with the repository default software-GL concurrency1 and residency paused. No product code, timeout or behavior assertion is weakened.

- The completed serial Game run passed548/549; the sole failure was an old equipment fixture mocking only the value-only RPC method. The shared reader now uses the context-preserving method. Both methods now return the same fake immutable-item records, retaining every appearance and pre-signature assertion. The focused test passes, all310 production inputs remain byte-identical, and the final full Game gate then passed549/549 before timing.

## Final controlled replay results

- Two corrected ABBA pairs use the same640x360/DPR1/view-distance7/seed setup and actual terrain Workers, plus24 preassembled buildings. Scheduling receives a fixed60 FPS input on both sides; this is not a measured FPS claim. Equipment remains empty and pose time is phase-relative.
- All437 final chunks have identical per-section vertex/index hashes in both pairs. All four runs dispose native buffers and textures to zero. Final return/settle screenshots were inspected directly.
- Actual scene-submit interval p50: moving299.95ms to199.95ms, eight actors291.65ms to141.60ms, town400.00ms to200.05ms. These are SwiftShader timings under a2-core quota; per-frame visible/ready geometry and sampling differ, so they are not equal-work hardware FPS multipliers.
- Raw rAF p95 does not generally improve: moving83.35ms to100.00ms. Turn draw p95 rises419 to1700 because changed unverified index orders retain canonical fallback. Stage CPU distributions describe submitted frames; raw rAF includes deferred callbacks.
- First nonempty CPU output320.65ms to282.30ms; first GPU-ready commit370.25ms to470.10ms; required terrain coverage3955.30ms to3854.30ms. Two pairs do not establish a stable production first-screen speedup.
- Complete CPU queue drain9939.95ms to11319.10ms is1.38s slower in this budget configuration. The town is built before the terrain timer, and authentication/page download are outside this fixture.
- Final full checks:530 engine tests and549 Game tests passed, zero failures/skips; actual host integration5/5 passed. The prior interrupted concurrency/UI attempt and completed548/549 stale-fixture attempt remain archived as failures. No production transaction is used.

## Final residency verification

- Active runtime1800011.17ms, excluding pauses, with300 edits and two actual context recoveries (final generation4). All outbound/return/turn/edit/player/town phases and24 complete buildings remain represented.
- Zero failed builds, Worker timeouts, last-build errors, page errors and GL allocation failures. Final screenshot inspected.
- Peaks: native buffers26.61MiB, shared pages24.00MiB, CPU mesh arrays30.77MiB, reusable mesh cache18.83MiB, descendant-process PSS731.09MiB. These are controlled fixture/accounting observations, not physical hardware VRAM.
- The last two-minute cycles retain bounded mesh/cache/buffer ranges. After disposal, buffer and texture objects/bytes are all zero. Arbitrary future worlds, models and drivers remain outside this30min fixture.
- Production inputs stayed byte-identical after the final build; documentation/test-only updates do not alter runtime content. No wallet, key, transaction rule, block/material ID, resolution or view-distance change is part of this work.
