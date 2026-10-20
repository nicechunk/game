# Persistent NCM demolition and material recovery (0.1.103)

NCM geometry is immutable per uploaded revision. Revision-scoped damage bits are
explicit air overrides and must survive reloads. Deed spatial indexing now keeps
the manifest damage flag, edit counter and slot so an intact IndexedDB payload
cannot take precedence over the chain removal mask.

Demolition instruction 7 now requires a backpack, material physics table, the
Building reward authority, the unified gameplay program and every authenticated
NCM shard. The program resolves the voxel from the full ordered command stack,
verifies shard PDAs/hash and commits its removal bit, one point of tool wear and
one standard system-resource credit atomically. Full inventories and rejected
CPIs roll back all state. An existing removal bit rejects repeated payouts.
Legacy eleven-account requests reject rather than silently removing without a
material credit. The gameplay backpack namespace adds instruction 23, callable
only by the Building reward PDA. Existing starter-tool and water routes retain
their deployed tags and logic.

Processed render materials return their underlying system resource: timber and
planks return wood, stone bricks return stone, glass returns sand, ceramic and
terracotta return clay. Each removed voxel returns one standard resource unit
from the existing governed physics table. The complete mapping is in chunk.js
construction/building-resource.js and is checked against Rust fixtures. Debug
NCM placement still consumes no materials. Previously confirmed removals retain
their existing masks; this change does not replay old demolition transactions.

The building sync keeps the last complete scene during damage-only manifest
updates. The controller swaps rendering, collision and targeting after the new
Worker result is ready. For the same revision-scoped building identity, the
renderer retains the old validated GPU mesh until its replacement upload passes
its completion fence. Context generation and terrain instance checks still apply.

Validation includes codec/Rust point-query parity for all ten NCM operations,
real SBF program transactions for credits and rollbacks, cold browser loads from
SBF account bytes with an intact persistent cache, and GPU upload backpressure.
Browser fixtures and unsigned Devnet simulation do not claim a real wallet
transaction or hardware performance acceptance.
