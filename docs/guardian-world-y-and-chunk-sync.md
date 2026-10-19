# Guardian Y capability and authoritative chunk synchronization

## Wire contract

The existing protocol byte remains `1`; wire lengths and chain account layouts are unchanged. **A packet length does not select a Y encoding.** The client advertises `Y_OFFSET32_V1 = 0x0008` in the little-endian HELLO client flags at bytes 2–3. The server includes that bit in HELLO_ACK flags at bytes 4–5 only when it accepted the capability. Both endpoints use offset encoding only after that ACK. A new client starts in legacy mode before ACK.

The world range is `-32 <= Y <= 320`. All two-byte Y fields are U16 little-endian. Their negotiated meaning is:

| Field | Legacy protocol 1 | Negotiated offset32-v1 |
| --- | --- | --- |
| DIG.blockY, DIG_BATCH item.blockY, DIG_EVENT.blockY, DIG_EVENT_BATCH item.blockY | `floor(Y)`; only nonnegative Y is representable | `floor(Y) + 32`, integer range 0–352 |
| MOVE.posY, MOVE_BATCH item.posY, every historical PLAYER_JOIN pose.posY | `round(Y * 64)`; only nonnegative Y | `round((Y + 32) * 64)`, range 0–22528 |

Move precision is **64 units per block**, and the horizontal chunk is **16×16**. Unsupported precision or chunk dimensions are rejected. Block and fractional player quantization are deliberately different. X/Z chunk lookup uses floor, including negative coordinates, and local chunk indices/offsets are range-checked instead of clamped into aliases. Y outside the world range, nonfinite numbers, truncated packets, and invalid local coordinates are rejected.

Examples: Y=-32/-17/-1/0/320 maps to block bytes `0000/0f00/1f00/2000/6001`. Player Y=-17.5 maps to `a003` (928 units). Y=0 maps to `0008` (2048 units). Byte vectors live in `play/tests/guardian-signed-y.test.mjs`; `sdk/guardian-wire.js` is the common SDK/browser quantizer, re-exported by `sdk/nicechunk-guardian.ts`.

### Compatibility

| Client | Guardian | Result |
| --- | --- | --- |
| Legacy | Legacy | Existing nonnegative-Y protocol |
| New | Legacy | HELLO accepted at version 1; no capability ACK; positive wire unchanged; negative movement/single/batch messages suppressed; no Y0 substitution or reconnect loop; authoritative terrain sync stays active |
| Legacy | New companion | Legacy positive messages normalized internally; positive broadcasts converted back; unrepresentable underground poses/events omitted |
| New | New companion | Negotiated negative and positive Y for movement, joins, dig, and batches |

The companion stores canonical offset32 internally. Connections subscribe to the existing chunk topic for legacy clients, or `:y32-v1` for negotiated clients. Every world event and move batch is published in both representations, filtering unrepresentable legacy items. Initial snapshots use the same conversion. Chat, equipment, registry accounts, building manifests, and chain PDAs retain their existing formats. Sequence ordering remains separate from chain slots; replayed/stale dig sequence numbers are rejected with wrap-aware U16 ordering.

The local companion was tested with real loopback WebSockets and three clients, including mixed legacy/new operation and reconnect. This is not a claim that public Guardian servers have been upgraded. Until they are upgraded, underground realtime movement remains degraded by design and terrain correctness relies on authoritative account reads. A legacy viewer may retain its last valid above-ground pose until its ordinary remote-player expiry; it never receives an invented Y0 underground pose.

## Authority and convergence

Three independent numbers have distinct meanings:

1. `executionSlot` comes only from the submitted transaction's `getSignatureStatuses.value[0].slot`.
2. `contextSlot` comes from the complete broken/placed `getMultipleAccounts` response bank. It is neither an account's last modification slot nor same-slot write order.
3. Guardian ticks/sequences are relay ordering metadata and do not advance either chain watermark.

Unknown slots are `null`, not a fabricated zero. Each RPC batch preserves its own true context. Broken and placed accounts for a chunk always share one `getMultipleAccounts` request; a malformed/missing half response does not become a complete snapshot.

Normal account reads use `finalized`. `minContextSlot` bounds node lag but is not used as a causal-order proof. A local confirmed edit has execution slot, commitment, signature, confirmation time, and a 30-second grace. A finalized snapshot initiated after confirmation and with context at least its execution slot can replace a different value, including a same-slot refill or a fork correction. An older context cannot roll back the confirmed edit. Confirmed-only or legacy confirmations without execution metadata require a newly initiated, known-context read after the 30-second grace. Persistent/memory previews never clear confirmation protection. Observing the exact confirmed value also releases its protection.

Protection does not require observing an intermediate air value: a finalized refill can directly correct a locally confirmed dig. Failed or superseded preparations do not partially modify chain data, protection maps, indices, or collision state. Actual local pending/remote changes advance a separate authority input revision and cause preparation to restart; a confirmed edit, base/input identity change or authority epoch change also invalidates it. Neighbor render/halo invalidation may advance the render world version without changing that authority input revision, so it does not repeatedly discard unchanged snapshot preparation. Final commit still checks actual inputs and the staged render plan instance. Transaction confirmation timeouts retain an **unknown submitted outcome**, not a chain failure. Status recovery does not resubmit. Only known execution errors cause failure rollback. Multi-action status without an exact coordinate receipt is handed to account recovery; it is not promoted to full success.

Guardian hints live in a separate overlay for at most five seconds, cannot override protected local edits, do not enter `chainDeltas`, do not advance watermarks, and are never written as verified cache data. A complete RPC snapshot supersedes them. Invalid/unloaded hints cannot create durable authority or fabricate a new chain state. A placement hint without a known material only invalidates the relevant chunk for a paired read.

## Freshness, requests, and application budgets

Nearby chunks (Chebyshev distance <=2) have 15-second TTL, middle chunks (<=6) 45 seconds, far chunks 120 seconds. Only a successful authoritative read advances freshness. Each batch keeps the observation time captured before yielding account decoding and canonicalization; slow CPU preparation cannot make its account bytes appear newer, for either a committed replacement or an unchanged-snapshot acknowledgement. Cache restoration and ordinary polling do not. Guardian connect/reconnect, visible page resume, online recovery, and RPC changes invalidate freshness; existing verified geometry remains visible while the replacement is prepared.

Defaults are eight chunks per RPC batch, at most eight batches per sync round, and four concurrent requests. The existing request cooldown is 900ms, and normal frame scheduling requests sync at 1200ms idle / 1800ms moving. Healthy near-state convergence is TTL + next scheduling opportunity + request/prepare latency; the controlled tests advance time beyond 15 seconds and show both clients converge after missed dig and place events. Reconnect invalidation removes the TTL wait. The operational target is near-state correction within 30 seconds, or within 15 seconds after reconnect, at 60 FPS with an available RPC responding within 100ms and a legal 4096-record account pair. The final measured real-ChunkManager preparation needed 277 moving frames (4.62 seconds at 60 FPS) for 4096 records, and 515 frames (8.58 seconds) for the extended 8192-record stress input; those are scheduling estimates, not measured renderer FPS. This is a bounded-request SLA under an available RPC, not a deadline guarantee during RPC outages, finality stalls, continuous conflicting local edits, or browser suspension.

Worker and production HTTP fallback share the same abortable transport and bounded work-conserving pool. Nearby completed batches are delivered immediately instead of waiting for a distant slow batch. Task IDs and sync epochs reject stale replies. Canceling an old view/RPC/page epoch aborts active HTTP requests and stops queued requests. Custom in-process embedders exposing only the SDK interface are result-cancelable; they must provide their own transport cancellation for underlying requests.

RPC and persistent restoration use three distance-tier application heaps. Each preparation quantum processes at most 64 entries and then returns the incomplete task to its heap. Near/middle/far **tiers** receive global service shares 8/4/1, independent of the number of tasks in each tier; empty tiers donate their share. Within each tier, virtual service rotates waiting tasks and a bounded initial work estimate favors small snapshots. Moving across a chunk boundary reclassifies outstanding work and rebuilds heaps over at most 512 pending snapshots, using linear heap construction rather than a full sort. Distance and work estimates select service; no partially prepared state is published. Background RPC admission pauses at 448 pending snapshots, reserving 64 slots for new near corrections rather than repeatedly reading and evicting distant accounts. Deferred targets remain stale.

Canonicalization, ordering, and state/index preparation yield in bounded slices. At nominal 60Hz, CPU allowances remain 1.8ms idle and 0.45ms moving, with 8192/2048 preparation entries and 320/64 completion records respectively. `play-chain-apply-budget.js` scales both time allowance and work limits by the actual callback interval, up to 4ms cooperative CPU budget, 16384 preparation entries and 2048 completion records; 30Hz moving uses 0.9ms and 4096 preparation entries. Resume resets to nominal allowance. A whole oversized snapshot can exceed the completion-record count and still commits as one complete atomic replacement. Each preparation step remains at most 64 entries. These are bounded cooperative allowances, not strict wall-clock guarantees during GC or nonpreemptible work. A large snapshot is prepared over multiple frames, then atomically swapped; collision/rendering never observe a partial account pair. Queue bounds are 512 snapshots and 131072 deltas; distant excess work is deferred for a later bounded round. Superseded heap entries are compacted. The raw snapshot cache is capped at 2048 records/131072 deltas and does not retain ChunkState/generator references. Freshness does not depend on retaining every loaded snapshot in that cache.

Cache schema `chain-chunk-snapshot-v2-pure-rpc` invalidates older records which could contain local protected/remote values. Only the validated raw account pair is persisted; the effective protected geometry is not a verified snapshot.

## Reproducible checks and limits

- `node --test play/tests/host-authority-sync.test.mjs play/tests/host-freshness-observation.test.mjs play/tests/pda-worker-budget.test.mjs play/tests/chain-confirmation-metadata.test.mjs`
- `node --test chunk.js/tests/authority-convergence.test.mjs`
- Browser checks: `chunk-pda-cache-browser.test.mjs` and `chain-uncertain-outcome-browser.test.mjs` through the normal test server.
- `NICECHUNK_GUARDIAN_VECTOR_BIN=/path/to/wire_vector_cli node --test play/tests/guardian-signed-y.test.mjs`
- `NICECHUNK_GUARDIAN_TEST_BIN=/path/to/nicechunk-guardian node --test play/tests/guardian-local-integration.test.mjs`

The optional executable tests explicitly skip without the companion binary; the ordinary JavaScript vectors still execute. They never contact a public Guardian or broadcast a transaction. Paired-RPC tests use controlled account bytes and real ChunkManager/Node Worker code. A real public Guardian + two wallets + live account-change end-to-end test has not been run. CPU slice and Chromium synthetic restoration metrics are recorded separately from actual renderer/GPU/long-session metrics; they are not a claim about hardware FPS.
