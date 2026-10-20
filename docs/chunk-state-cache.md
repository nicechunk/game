# Finalized ordinary chunk caching and presentation (0.1.96)

## Scope and authority

This path reads ordinary `chunk-broken` and `chunk-placed` PDAs at finalized commitment. It retains independent lossless account bodies, including Broken coordinates hidden by Placed, Placed volume, unused allocated bytes, owner/executable and validated layout descriptors. Component SHA-256 and pair tokens exclude slot and observation time. Rendering uses a separate canonical projection. These hashes check cached content integrity; they do not prove current chain state.

Contracts, PDA seeds, rent, transaction permissions, confirmed transaction preflight, pending actions and confirmed protection layers are unchanged. Natural decoration `surface-picked` accounts remain on their separate existing synchronization path.

## Reads and watermarks

- At most 100 accounts / 50 pairs per batch and four concurrent RPC batches.
- Cold near batches contain at most eight pairs; background and warm batches can contain 50. This can increase cold request counts to deliver nearby data sooner.
- Conditional thresholds use the minimum captured pair watermark, inclusively. `minContextSlot` independently enforces the required read floor. A global maximum slot is never used as every pair's conditional baseline.
- A request captures immutable components and their token. Mixed full/unchanged/null results produce one verified pair before content and its actual watermark publish atomically.
- Only strict null means absent. Only an explicit, unambiguous `{status:"unchanged"}` permits captured-baseline reuse. An unchanged result following an absent component requires targeted full repair.
- Validation covers JSON-RPC identity, context, length/order, owner, executable, layout, capacity, coordinates, duplicate records, volume and encoding. An error preserves existing geometry and only retries its affected pair.
- Double unchanged skips component decoding, body hashing, sorting, canonicalization, meshing and upload. Presentation recovery remains a separate check.

## Endpoint capabilities and optional compression

Base64 is the default. Conditional support is cached per endpoint/configuration epoch and confirmed only by an actual unchanged response. A server that ignores the extension and returns full is consumed directly without a second read. Explicit unsupported-parameter errors receive bounded fallback. A timeout or 429 is not evidence of unsupported capability. Congestion uses global backoff; invalid pairs use 1-15 second local backoff. Precise hint events invalidate only the relevant pair.

Optional Zstd is enabled by setting `nicechunk.chunkRpcEncoding` to `base64+zstd` in the existing client configuration storage and refreshing. Removing that entry restores the default. RPC URL and API keys still come from the existing configuration. Production main-thread fallback requests base64; compressed decoding runs in the PDA Worker. Only full accounts load the decoder. Output is limited to 18,448 bytes, independently of the maximum 8 MiB frame window, bounded compressed input and frame/block counts. Truncated and concatenated frames are rejected. Actual public RPC small-account frames can declare a 2 MiB window. fzstd 0.1.1's original MIT notice is in `play/vendor/fzstd.LICENSE` and is included in the runtime package.

Encoding and conditional capabilities are independent. Invalid compressed content keeps the old world and targeted repair requests base64. Neither compression nor conditional responses inherently reduces RPC calls, credits, transaction fees or PDA costs.

## Durable cache and memory

IndexedDB upgrades to DB v2, retaining `snapshots` and adding `account-pairs`. One transaction writes both components, their projection, token and watermark. Transaction/quota failure does not undo a verified memory publication. Same-key writes coalesce; unchanged metadata writes are limited to once per 30 seconds. Pending persistence also has entry and byte limits.

Main memory and Worker pair caches each allow at most 2,048 entries / 64 MiB of admission charges; disk allows twice those limits. Typed-array bytes are exact; JS records and objects use conservative charges rather than measured browser heap sizes. LRU eviction does not destroy captured in-flight references. Only newly allocated compact projection arrays transfer across the Worker boundary; unique cached raw buffers do not detach. A Worker that has lost a token performs one full read instead of mixing unknown components.

Scope includes observed genesis, program, globalConfig, derivation seeds, account format, world/generation/rules and dimensions. A provider switch on the same verified chain can reuse content, while obsolete requests cannot publish into a new authority epoch. Initial chain identity verification may add one bootstrap read. Slow disk never gates necessary nearby RPC, so cold full reads can race disk recovery.

Old merged v2 snapshots cannot serve as lossless incremental baselines. After matching the reviewed 0.1.95 Devnet genesis/program/global PDA/seeds, their old namespace can supply a visual preview followed by lazy full-pair upgrade. Unconfirmed old namespaces remain stored but are not shown.

## Interest, progress and presentation

Interest changes immediately restore hot memory, start asynchronous disk recovery and schedule required reads. Normal movement retains overlapping requests. Authority and endpoint changes still cancel old epochs. Guardian and local events are invalidation hints, not finalized proofs. Existing 15/45/120 second near/middle/far authoritative checks remain. Resume and reconnect trigger catch-up. This does not add whole-program scans or unbounded subscriptions.

One rotating host stage per frame receives at most 0.8ms of reserved service: snapshot, building, mesh or upload. The shared soft allowance remains; low-level expired deadlines still do no work. Real GPU waits/context loss are counted separately, without gl.finish. An indivisible operation can exceed a soft slice; hardware frame percentiles require separate acceptance.

Once terminal and all expected Worker packets validate, the computing slot is released while revision-checked publication continues. Twenty-four ready jobs or 64 MiB queued geometry apply dispatch backpressure, in addition to the finite already-computing tasks. A later computing failure cannot discard that Worker's earlier complete publication data.

Common ordinary opaque blocks use bounded fully textured local feedback: at most 32 actions / 64 CPU prototypes. They hand off only when the official section's matching revision has a validated GPU handle. Rollback removes only its own action. Removal, cave walls and exposed neighboring faces remain the section mesher's responsibility. Complex/transparent resources and cactus use their complete existing model path, without generic placeholder cubes. The feedback path preserves staging, fences and context checks; it does not guarantee a one-to-two-frame software-GPU result.

`presentationRequest.firstDrawSubmitted` is recorded only after an actual draw of the target geometry revision. It includes pairValidated-to-firstDraw and interestEnter-to-firstDraw timing. GPU submission is distinct from screen presentation and authenticated device acceptance.

## Verification

- `npm run check` runs the Game suite. Existing Guardian companion tests require their two binary environment variables.
- `cd chunk.js && npm run check` runs the Engine suite and browser artifact checks.
- New cases: `chunk-incremental-pairs.test.mjs`, `chunk-service-progress.test.mjs` and `chunk-incremental-browser.test.mjs`.
- Browser cases can run with `NICECHUNK_TEST_SOFTWARE_GL=1 node --import ./scripts/test-browser-setup.mjs --test --test-concurrency=1 play/tests/chunk-incremental-browser.test.mjs`. `NICECHUNK_INCREMENTAL_EVIDENCE` selects an evidence directory.
- Delivery workspace scripts retain finite real read-only samples, paired ABBA account replays, actual published Worker execution and public file hashes. Simulations, software GL and real network reads are reported separately.

The optional shared hash/ETag service is not enabled. These paths operate without Guardian reconstruction, new contracts or such a service.
