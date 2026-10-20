# Container capacity and water tools

The earlier local automatic and separate-certification design was superseded by the default-off, atomic optional water property. Current deployed behavior is documented in [the optional water release](water-opt-in-20261020.md).

Capacity is derived from immutable NCF1 model geometry at integer 1/2048 m boundaries. Backpack instruction 20 certifies an existing item; the current forge flow certifies during atomic creation when requested. ForgedItem v1 stays 752 bytes: bytes 90..94 store u32 mL and bytes 94..96 store the rule version and cavity seed. Uncertified older items have zero certified capacity.

Chunk instruction 24 validates a natural-water target, placed overrides, permissions, distance, actual equipment custody, model identity and certified item capacity. Player instruction 19 and Backpack instruction 21 require the collection-program authority. Each completed cycle awards exactly 1000 mL and 1000 g of resource 8, consuming ceil(1000 / capacityMl) durability. Overflow does not carry to another cycle. Failures roll back rewards, durability and replay state together; inventory overflow cannot consume durability. Water does not remove terrain or update mining and Skills progress.

The historical local workspace `/workspace/water-tools-20261020` recorded 120 native checks, 109 client/engine checks, browser property-panel checks and 90 LiteSVM transactions using public account snapshots. These were local simulations, not public diagnostic broadcasts or a subsequent release's test results. The later optional-water task independently deployed its final programs and runtime; refer to its own manifests for those results.
