# Stone axe handle length — 2026-10-19

## Model

The basic stone axe's wooden shaft is now exactly twice as long: **27 → 54 Q6 units (0.421875 → 0.84375 m)**. Its thickness and the stone head, cutting edge and wrapping dimensions stay the same. The head and wrapping move 27 Q6 units to the extended shaft end.

The north / −Z palm anchor remains at design-space `[0, 7, -1]`, with axis `2`, sign `−1`, rotation `0`. The handle center moves to `[0, 24, 0]` and its local grip becomes `[0, -17, -1]`. The cutting edge still points down in the carry pose. The integer Q6 grid rounds the shaft center by half a unit (7.8125 mm); this does not move the palm anchor.

The contract creates the new canonical **62-byte NCF1**, hash **4196919582**. The recipe remains **1 stone fragment + 2 twigs**, initial durability **99**, with no fuel or station requirement. Equipment statistics and authoritative inventory quantities are unchanged.

## Existing axes

Both previously issued starter axe payloads display the same long shaft. Recognition requires an exact match to their original bytes. Verification, equipment identity, design hash, payload, ownership and durability continue to use the original authenticated item.

`forgePresentationForRuntime` supplies the geometry and grip to avatar rendering, avatar collision validation and backpack icons after payload verification. Local avatars, remote avatars and item previews agree. Other forged items continue to use their own geometry and grip.

## Validation

- **43 native Backpack tests**, **27 client/engine checks** (including the browser recipe flow).
- **21 complete local SBF transactions**: new crafting, v2 crafting before upgrade, and v1 crafting before upgrade; all three equip and complete their first equipped mine with durability **99 → 96**. Bare collection remains zero XP; gravel cannot replace stone fragments.
- **Eight actual WebGL2 view contexts** using ANGLE/SwiftShader, idle and swing screenshots, **three production remote-avatar payload restorations**, and **three matching backpack icon previews**.
- Palm contact, downward carry edge, body clearance, and rigid visual/collision parity across **24 swing/pitch combinations for each of three payload versions**. Cloth wrapping retains its normal visual flutter.

Evidence: `/workspace/stone-axe-long-handle-20261019/report.json`, `visual-verification.json`, `idle-front-side.png`, `swing-impact.png`, and the three `full-*-lifecycle.json` reports. These are focused equipment checks; full world/multiplayer rendering regression remains separate.

## Concurrent production release preserved

Before installation, the deployment guard detected the separately published rendering repair (website 0.1.76, runtime `play-bundle-0a6d14484b49cb82`). Its exact deployed Game `ece295c4df76816ea7270394c80a565ffb99bada` and engine `96e2c0466d3c4e3ea0ffb2f90e6f7ade155d2a58` were verified against local Git bundles and public runtime hashes, then merged without conflicts. The long-handle release follows as **0.1.77**, preserving those rendering and authority synchronization changes.

The merged source passed the 27 focused checks and all eight WebGL2 views again. Its packaged HTTP terrain Worker matched the seven-face oracle and complete vertex/index output. Crafting/equipment instructions serialize identically to the 21 previously verified SBF transactions, and the deployed Game artifact is unchanged by this client source merge.

## Verified release

- Game upgrade finalized on Devnet at slot **512777890**, **683,480 bytes**, SHA-256 `69dcaabee5d226a281032a069445139d779d7c7bc80ea0fc09a54742ecd51c7a`. Public RPC verified the executable bytes, zero padding, unchanged upgrade authority and closed upload buffer. No capacity extension was needed.
- Website **0.1.77**, runtime `play-bundle-3e23adf24b31797c`; all **54 published game files** matched local hashes.
- The actual public HTTP terrain Worker matched the seven-face oracle and complete vertex/index output after the rendering-source merge.
- Chunk, Skills and MaterialPhysics revision 3 / 113 rules retain their verified prior state. Mainnet was not modified. No player harvesting transaction was broadcast.
