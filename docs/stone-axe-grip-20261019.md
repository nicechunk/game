# Stone axe grip and orientation — 2026-10-19

## Binding

- The canonical starter axe uses the wooden handle's **north / −Z face**, component-local grip `[0, -3, -1]` in Q6, normal axis `2`, sign `−1`, rotation `0`.
- Its design-space grip is `[0, 7, -1]`. The shaft points forward from the palm; the stone cutting edge faces the ground in the carry pose. Reference placement is the previous default iron pickaxe's palm binding and shared shoulder/item pivots.
- The model is turned around its Y axis before encoding so this north grip gives the intended downward edge. Equipment statistics, dimensions, material quantities and 99 initial durability remain the same.
- The Game contract creates the corrected 62-byte canonical NCF1. The client and contract payloads must match.

## Existing axes

Already-crafted v1 axes retain their original authenticated NCF1 bytes, design hash, custody and durability. An exact-byte presentation rule uses the equivalent handle-side grip `[-1, 7, 0]`, normal axis `0`, sign `−1`, rotation `0`, before the new model-space turn. New and legacy axe component bounds match once mounted.

The shared avatar mesh and collision report use this same binding. Local avatars, remote avatars and previews therefore agree. Other forged models retain their own encoded grip. Both exact axe versions keep the Basic Stone Axe backpack name.

## Verification

Validation includes palm contact using the actual handle component, downward edge in idle/walking, body clearance and visible/collision alignment over 24 swing/pitch combinations per version. The cloth wrapping retains its normal visual flutter; rigid handle, head and edge match their physical boxes.

The browser check renders six actual WebGL2 views through ANGLE/SwiftShader, including the previous default pickaxe as a reference, and checks both payload versions through the production remote-avatar restoration path. This is a focused equipment rendering check; it does not constitute a full multiplayer/world rendering regression.

Evidence: `/workspace/stone-axe-grip-20261019/report.json`, `visual-verification.json`, `idle-front-side.png` and `swing-impact.png`.

## Verified release

- Game finalized upgrade: slot **512773689**, **683,480 bytes**, SHA-256 `31e0623ba9be45da5ad58d346a2f5c9e517163a9da49c15e439c1d0bb19fdfc2`. Public RPC verified exact executable bytes, unchanged authority, zero padding and closed upload buffer. No program extension was needed.
- Website **0.1.75**, runtime `play-bundle-9b9ff95c889750ef`; all **51 published game files** matched local hashes.
- **43 native Backpack tests**, **23 related client/engine checks**, **14 complete local SBF transactions**. Both new crafting and a v1 axe crafted before an in-VM Game upgrade equip successfully and mine with durability **99 → 96**, with normal equipped XP.
- **Six actual WebGL2 view contexts**, with idle/impact screenshots and **two production remote-avatar payload restorations**. Tested handle contact, downward carry edge, body clearance and rigid visual/collision parity for 24 swing/pitch combinations per version.
- Chunk, Skills and MaterialPhysics revision 3 / 113 rules retain their prior public-verified state. Mainnet was not modified. No player harvesting transaction was broadcast.
