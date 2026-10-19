# Stone axe handle length — 2026-10-19

## Model

The basic stone axe's wooden shaft is now exactly twice as long: **27 → 54 Q6 units (0.421875 → 0.84375 m)**. Its thickness and the stone head, cutting edge and wrapping dimensions stay the same. The head and wrapping move 27 Q6 units to the extended shaft end.

The north / −Z palm anchor remains at design-space `[0, 7, -1]`, with axis `2`, sign `−1`, rotation `0`. The handle center moves to `[0, 24, 0]` and its local grip becomes `[0, -17, -1]`. The cutting edge still points down in the carry pose. The integer Q6 grid rounds the shaft center by half a unit (7.8125 mm); this does not move the palm anchor.

The contract creates the new canonical **62-byte NCF1**, hash **4196919582**. The recipe remains **1 stone fragment + 2 twigs**, initial durability **99**, with no fuel or station requirement. Equipment statistics and authoritative inventory quantities are unchanged.

## Existing axes

Both previously issued starter axe payloads display the same long shaft. Recognition requires an exact match to their original bytes. Verification, equipment identity, design hash, payload, ownership and durability continue to use the original authenticated item.

`forgePresentationForRuntime` supplies the geometry and grip to avatar rendering, avatar collision validation and backpack icons after payload verification. Local avatars, remote avatars and item previews agree. Other forged items continue to use their own geometry and grip.

## Validation

- **43 native Backpack tests**, **25 client/engine checks** (including the browser recipe flow).
- **21 complete local SBF transactions**: new crafting, v2 crafting before upgrade, and v1 crafting before upgrade; all three equip and complete their first equipped mine with durability **99 → 96**. Bare collection remains zero XP; gravel cannot replace stone fragments.
- **Eight actual WebGL2 view contexts** using ANGLE/SwiftShader, idle and swing screenshots, **three production remote-avatar payload restorations**, and **three matching backpack icon previews**.
- Palm contact, downward carry edge, body clearance, and rigid visual/collision parity across **24 swing/pitch combinations for each of three payload versions**. Cloth wrapping retains its normal visual flutter.

Evidence: `/workspace/stone-axe-long-handle-20261019/report.json`, `visual-verification.json`, `idle-front-side.png`, `swing-impact.png`, and the three `full-*-lifecycle.json` reports. These are focused equipment checks; full world/multiplayer rendering regression remains separate.
