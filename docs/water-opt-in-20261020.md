# Optional water collection, deployed in Play 0.1.99

Water collection is an optional forge property, disabled by default. Ordinary forging requests 320,000 CU and does not certify container geometry. Water-enabled forging requests 1,400,000 CU and a 256 KiB heap, certifying the immutable final model in the same atomic creation instruction. Leaks, missing bottoms, invalid grips, excessive complexity and exhausted compute reject creation and roll back materials, items and counters. Oversized packets are rejected without separating creation and certification. Independent certification remains available for existing items.

Backpack, equipment and market displays use contract-certified whole-mL capacity. Natural water (block 17) remains in the world. Each completed cycle returns one resource-8 unit, exactly 1000 mL and 1000 g; contacts per cycle are ceil(1000 / capacityMl). Overflow is discarded and the next cycle starts at zero. The contract atomically settles the corresponding durability and strictly stores one water unit. Session, identity, replay and inventory capacity checks remain authoritative. Water collection gives no mining or Skills progress.

## Previous release evidence

The previous task recorded 120 native contract checks, 53 targeted client/engine checks, four browser model cases, and 110 local LiteSVM transactions against the released ELF. Simulations used public account snapshots with signature verification disabled and did not broadcast diagnostic transactions. This inherited evidence is not a test executed for the subsequent bulk-mining or deed release.

| Forge and Skills example | Ordinary CU | Water-enabled CU |
| --- | ---: | ---: |
| Component cup | 66,730 | 272,640 |
| Workbench small cup | 72,736 | 284,201 |
| Appearance cup | 73,372 | 390,451 |

These examples use an existing Skills account and are not worst-case limits. One complex geometry consumed the entire water budget and rolled back. Final ELF compilation used opt-level=z. The release used existing deployment-wallet funding without a treasury transfer.

Geometry supports the +Y orientation and one selected cavity, integer 1/2048 m boundaries, at most 63 coordinates per axis and fewer than 65,535 cells. General bent-neck and multiple-opening topology remains limited. Soft cloth is not certified as a rigid shell. Eight and twelve connected-basin stress cases exceeded budget and were rejected. Existing material input policy was preserved.

The original release source and evidence are in `/workspace/water-opt-in-20261020`. Deployed program, public-file and browser records from that task are the authority for its release; product naming in mainnet.json does not change its Devnet network. The next release preserves this deployed runtime in an isolated Git snapshot.
