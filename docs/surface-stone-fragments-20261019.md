# Surface Stone Fragments — 2026-10-19

## Active rules

- Loose surface stones are **Stone Fragment**, block ID **55**, resource group **30**. Terrain Gravel retains ID **6** and all existing ordinary uses.
- Pickup authenticates the generated terrain, canonical decoration, session, land protection, Chunk PDA and Backpack. It grants one 500,000 mm³ fragment (500 cm³), density 2,600 kg/m³, mass 1,300 g. The ground remains intact and a per-column pickup bit prevents repeat claims.
- Bare-hand terrain excavation is disabled, including Gravel. Bare hands support only natural leaves and authenticated loose-stone pickup.
- The fixed starter recipe requires **1 Stone Fragment (55) + 2 Twig (54)** and creates one canonical basic stone axe with **99/99 durability**. Gravel and ordinary Stone cannot substitute. No station, fuel or skill prerequisite is added.
- Bare hands still cause no skill instructions, skill bonuses, XP, deferred mining events or progress changes. Equipped mining retains its normal skills and contract debit of 3 durability per successful transaction.
- MaterialPhysics revision **3**, **113 rules**, adds fragment ID 55 while retaining every previous governed rule. No account layout, account size, authority or existing inventory migration is required. Old Gravel inventory remains Gravel.
- Client resource mapping, backpack name/icon, reward preview, capacity check and recipe selection share the fragment ID. Chinese locale labels distinguish Stone Fragment from Gravel while preserving Gravel's existing meaning.

## Validation and release

Release evidence is recorded in `/workspace/surface-pebble-resource-20261019/report.json` and `final-verification.json` after verification. Only Devnet is targeted; Mainnet is unchanged. Public player checks use read-only transaction simulation and do not broadcast player harvests.

## Verified release

- **99 native contract tests**, **42 related client checks**, **61 complete local SBF transactions** (including two real-signature authority attacks). Verified the empty-player lifecycle, fragment volume/mass, failed recipe atomicity, duplicate pickup rejection, unchanged bare Skills state and the first axe harvest at 96 durability with normal XP.
- **Four public read-only complete transaction simulations**, using the verified online 0.1.74 module. Surface pickup credits ID 55, 500,000 mm³ and 1,300 g; Gravel quantity is unchanged. No player harvesting transactions were broadcast. Signature verification is disabled only for the public player fixture simulations; program upgrades and the governed material update are signed and finalized.
- Published game **0.1.74**, runtime `play-bundle-e10abd6ffd2cc428`; independently verified **51 game runtime files** and **23 homepage/resource-page files**. Full multiplayer/WebGL rendering is outside this verification.
- Programs and material table were verified through public Devnet RPC with exact executable bytes, zero padding, retained authority and closed upload buffers. No program extension was needed. Skills remains at its previous finalized deployment.

| Component | Finalized slot | Effective bytes |
|---|---:|---:|
| Game | 512768928 | 683480 |
| Chunk | 512769144 | 370632 |
| Skills | 512761309 | 116040 |
| MaterialPhysics revision 3 / 113 rules | 512768546 | 1,040 |

Public player simulations do not prove a broadcast harvest by a real wallet. Existing Gravel inventory was not converted, and Mainnet was not modified.
